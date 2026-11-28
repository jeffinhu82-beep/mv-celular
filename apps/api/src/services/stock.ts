import { weightedAverageCost } from '@loja/shared';
import type { StockMovementType } from '../generated/prisma/client.ts';
import type { Tx } from '../db.ts';
import { notFound, unprocessable } from '../lib/errors.ts';

export interface StockChange {
  productId: string;
  qty: number;
  type: StockMovementType;
  userId: string | null;
  unitCostCents?: number;
  reason?: string | null;
  supplier?: string | null;
  refType?: string | null;
  refId?: string | null;
  refNumber?: string | null;
  requireAvailable?: boolean;
}

export async function lockProduct(tx: Tx, productId: string) {
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId}::uuid FOR UPDATE`;
  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) throw notFound('Produto não encontrado.');
  return product;
}

export async function applyStockChange(tx: Tx, change: StockChange) {
  const product = await lockProduct(tx, change.productId);
  if (!product.tracksStock || product.type !== 'product') return null;
  const balanceAfter = product.stockQty + change.qty;
  if (change.requireAvailable && change.qty < 0 && balanceAfter < 0) {
    throw unprocessable(`Estoque insuficiente para ${product.name}: disponível ${product.stockQty}.`, 'INSUFFICIENT_STOCK', {
      productId: product.id,
      available: product.stockQty,
    });
  }
  const costCents =
    change.type === 'purchase' && change.unitCostCents !== undefined
      ? weightedAverageCost(product.stockQty, product.costCents, change.qty, change.unitCostCents)
      : product.costCents;
  await tx.product.update({ where: { id: product.id }, data: { stockQty: balanceAfter, costCents } });
  return tx.stockMovement.create({
    data: {
      productId: product.id,
      type: change.type,
      qty: change.qty,
      unitCostCents: change.unitCostCents ?? product.costCents,
      balanceAfter,
      reason: change.reason ?? null,
      supplier: change.supplier ?? null,
      refType: change.refType ?? null,
      refId: change.refId ?? null,
      refNumber: change.refNumber ?? null,
      userId: change.userId,
    },
  });
}

export async function reservedInOpenOrders(tx: Tx, productIds: string[], exceptServiceOrderId?: string) {
  if (productIds.length === 0) return new Map<string, number>();
  const rows = await tx.serviceOrderItem.groupBy({
    by: ['productId'],
    where: {
      productId: { in: productIds },
      kind: 'part',
      serviceOrder: {
        column: { stageType: { in: ['entry', 'in_progress', 'ready'] } },
        OR: [{ approvalStatus: null }, { approvalStatus: { not: 'rejected' } }],
        ...(exceptServiceOrderId ? { id: { not: exceptServiceOrderId } } : {}),
      },
    },
    _sum: { qty: true },
  });
  return new Map(rows.map((row) => [row.productId as string, row._sum.qty ?? 0]));
}
