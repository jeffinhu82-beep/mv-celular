import {
  computeCart,
  computeCheckout,
  formatBps,
  formatMoney,
  type CartTotals,
  type DiscountInput,
  type FeeConfig,
  type PaymentInput,
  type PermissionKey,
  type SessionUser,
} from '@loja/shared';
import type { Product } from '../generated/prisma/client.ts';
import type { Db, Tx } from '../db.ts';
import type { Deps } from '../deps.ts';
import type { Approver } from '../http/auth.ts';
import { notFound, unprocessable } from '../lib/errors.ts';
import { lockProduct, reservedInOpenOrders } from './stock.ts';

export interface Actor {
  deps: Deps;
  user: SessionUser;
  ip: string;
  approver: Approver | null;
  can(key: PermissionKey): boolean;
  approve(key: PermissionKey, message?: string): Promise<Approver | null>;
}

export interface ItemDraft {
  productId?: string | null;
  name: string;
  qty: number;
  unitPriceCents: number;
  discount?: DiscountInput | undefined;
}

export interface PricedItem {
  productId: string | null;
  name: string;
  qty: number;
  unitPriceCents: number;
  listPriceCents: number | null;
  unitCostCents: number;
  discountMode: string | null;
  discountValue: number | null;
  discountCents: number;
  totalCents: number;
  tracksStock: boolean;
  position: number;
}

export interface PriceOverride {
  productId: string;
  name: string;
  listPriceCents: number;
  unitPriceCents: number;
}

export interface Pricing {
  items: PricedItem[];
  cart: CartTotals;
  overrides: PriceOverride[];
}

export async function lockProducts(tx: Tx, ids: (string | null | undefined)[]): Promise<Map<string, Product>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort();
  const products = new Map<string, Product>();
  for (const id of unique) products.set(id, await lockProduct(tx, id));
  return products;
}

export function priceItems(drafts: ItemDraft[], products: Map<string, Product>, discount?: DiscountInput): Pricing {
  const overrides: PriceOverride[] = [];
  const base = drafts.map((draft, position) => {
    const product = draft.productId ? products.get(draft.productId) : undefined;
    if (draft.productId && !product) throw notFound('Produto não encontrado.');
    if (product && !product.active) throw unprocessable(`${product.name} está inativo e não pode ser vendido.`, 'PRODUCT_INACTIVE');
    if (product && draft.unitPriceCents !== product.priceCents) {
      overrides.push({ productId: product.id, name: product.name, listPriceCents: product.priceCents, unitPriceCents: draft.unitPriceCents });
    }
    return {
      productId: product?.id ?? null,
      name: product?.name ?? draft.name.trim(),
      qty: draft.qty,
      unitPriceCents: draft.unitPriceCents,
      listPriceCents: product ? product.priceCents : null,
      unitCostCents: product?.costCents ?? 0,
      discount: draft.discount && draft.discount.value > 0 ? draft.discount : undefined,
      tracksStock: Boolean(product && product.type === 'product' && product.tracksStock),
      position,
    };
  });
  const cart = computeCart(
    base.map((item) => ({ qty: item.qty, unitPriceCents: item.unitPriceCents, unitCostCents: item.unitCostCents, discount: item.discount })),
    discount,
  );
  const items = base.map((item, index) => ({
    productId: item.productId,
    name: item.name,
    qty: item.qty,
    unitPriceCents: item.unitPriceCents,
    listPriceCents: item.listPriceCents,
    unitCostCents: item.unitCostCents,
    discountMode: item.discount?.mode ?? null,
    discountValue: item.discount?.value ?? null,
    discountCents: cart.items[index]!.discountCents,
    totalCents: cart.items[index]!.totalCents,
    tracksStock: item.tracksStock,
    position: item.position,
  }));
  return { items, cart, overrides };
}

export interface PricingApproval {
  approvedById: string | null;
  overLimit: boolean;
}

export async function approvePricing(actor: Actor, pricing: Pricing): Promise<PricingApproval> {
  let approvedById: string | null = null;
  if (pricing.overrides.length > 0) {
    const approver = await actor.approve('sale.price_override', 'Alterar o preço de um item precisa de autorização.');
    approvedById = approver?.id ?? approvedById;
  }
  const overLimit = pricing.cart.discountCents > 0 && pricing.cart.effectiveDiscountBps > actor.user.discountLimitBps;
  if (overLimit) {
    const approver = await actor.approve(
      'sale.discount_over_limit',
      `Desconto de ${formatBps(pricing.cart.effectiveDiscountBps)} passa do seu limite de ${formatBps(actor.user.discountLimitBps)}. Peça a autorização de quem tem permissão.`,
    );
    approvedById = approver?.id ?? approvedById;
  }
  return { approvedById, overLimit };
}

export async function assertStock(tx: Tx, items: Pick<PricedItem, 'productId' | 'qty' | 'tracksStock'>[], products: Map<string, Product>, exceptServiceOrderId?: string) {
  const needed = new Map<string, number>();
  for (const item of items) {
    if (!item.productId || !item.tracksStock) continue;
    needed.set(item.productId, (needed.get(item.productId) ?? 0) + item.qty);
  }
  if (needed.size === 0) return;
  const reserved = await reservedInOpenOrders(tx, [...needed.keys()], exceptServiceOrderId);
  for (const [productId, qty] of needed) {
    const product = products.get(productId)!;
    const available = product.stockQty - (reserved.get(productId) ?? 0);
    if (qty > available) {
      throw unprocessable(
        `Estoque insuficiente para ${product.name}: disponível ${Math.max(0, available)}.`,
        'INSUFFICIENT_STOCK',
        { productId, available: Math.max(0, available) },
      );
    }
  }
}

export function checkoutOrThrow(dueCents: number, payments: PaymentInput[], config: FeeConfig) {
  const checkout = computeCheckout(dueCents, payments, config);
  if (checkout.errors.length > 0) {
    throw unprocessable(checkout.errors[0]!, 'INVALID_PAYMENT', { errors: checkout.errors });
  }
  return checkout;
}

export function remainingMessage(remainingCents: number) {
  return `Falta receber ${formatMoney(remainingCents)}.`;
}

export async function lockSale(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${id}::uuid FOR UPDATE`;
  const sale = await tx.sale.findUnique({ where: { id }, include: { items: { orderBy: { position: 'asc' } } } });
  if (!sale) throw notFound('Venda não encontrada.');
  return sale;
}

export async function userNames(db: Db | Tx, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map<string, string>();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name]));
}

export async function getSaleDetail(db: Db, id: string) {
  const sale = await db.sale.findUnique({
    where: { id },
    include: {
      items: { orderBy: { position: 'asc' } },
      payments: { orderBy: { receivedAt: 'asc' } },
      customer: { select: { id: true, name: true, phoneE164: true, cpf: true } },
      serviceOrder: { select: { id: true, number: true, brand: true, model: true } },
    },
  });
  if (!sale) throw notFound('Venda não encontrada.');
  const logs = await db.auditLog.findMany({ where: { entity: 'Sale', entityId: id }, orderBy: { createdAt: 'asc' } });
  const names = await userNames(db, [
    sale.sellerId,
    sale.cancelledById,
    sale.approvedById,
    ...sale.payments.map((payment) => payment.receivedById),
    ...logs.flatMap((log) => [log.userId, log.approvedById]),
  ]);
  const activePayments = sale.payments.filter((payment) => !payment.reversedAt);
  const feeCents = activePayments.reduce((sum, payment) => sum + payment.feeCents, 0);
  const chargedCents = activePayments.reduce((sum, payment) => sum + payment.amountCents, 0);
  return {
    ...sale,
    sellerName: names.get(sale.sellerId) ?? '',
    cancelledByName: sale.cancelledById ? (names.get(sale.cancelledById) ?? null) : null,
    approvedByName: sale.approvedById ? (names.get(sale.approvedById) ?? null) : null,
    balanceCents: sale.status === 'pending' ? sale.totalCents - sale.paidCents : 0,
    chargedCents,
    changeCents: activePayments.reduce((sum, payment) => sum + payment.changeCents, 0),
    feeCents,
    netCents: chargedCents - feeCents,
    marginCents: sale.totalCents - sale.costCents,
    payments: sale.payments.map((payment) => ({ ...payment, receivedByName: names.get(payment.receivedById) ?? '' })),
    logs: logs.map((log) => ({
      id: log.id,
      action: log.action,
      createdAt: log.createdAt,
      userName: log.userId ? (names.get(log.userId) ?? null) : null,
      approvedByName: log.approvedById ? (names.get(log.approvedById) ?? null) : null,
      after: log.after,
    })),
  };
}
