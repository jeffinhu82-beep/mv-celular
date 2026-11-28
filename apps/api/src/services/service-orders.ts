import {
  addDays,
  CLOSED_STAGE_TYPES,
  computeCart,
  STAGE_TYPE_LABELS,
  type FeeConfig,
  type OsEventType,
  type PaymentInput,
  type PermissionKey,
  type StageType,
} from '@loja/shared';
import type { CashSession, KanbanColumn, Prisma } from '../generated/prisma/client.ts';
import type { Tx } from '../db.ts';
import { audit } from '../lib/audit.ts';
import { nextNumber } from '../lib/counter.ts';
import { conflict, notFound, unprocessable } from '../lib/errors.ts';
import { recordPayments, reversePayments } from './cash.ts';
import { billableDiscount, billableLines, isRejected } from './receivables.ts';
import { checkoutOrThrow, lockProducts, remainingMessage } from './sales.ts';
import { applyStockChange } from './stock.ts';

export interface ScopeActor {
  user: { id: string };
  can(key: PermissionKey): boolean;
}

export function serviceOrderScope(actor: ScopeActor): Prisma.ServiceOrderWhereInput {
  return actor.can('os.view_all') ? {} : { OR: [{ technicianId: actor.user.id }, { technicianId: null }] };
}

const lockedInclude = {
  column: true,
  items: { orderBy: { position: 'asc' } },
  payments: { orderBy: { receivedAt: 'asc' } },
  sale: { select: { id: true, number: true, status: true } },
} satisfies Prisma.ServiceOrderInclude;

export async function lockServiceOrder(tx: Tx, id: string, scope: Prisma.ServiceOrderWhereInput = {}) {
  await tx.$queryRaw`SELECT id FROM "ServiceOrder" WHERE id = ${id}::uuid FOR UPDATE`;
  const os = await tx.serviceOrder.findFirst({ where: { AND: [{ id }, scope] }, include: lockedInclude });
  if (!os) throw notFound('OS não encontrada.');
  return os;
}

export type LockedServiceOrder = Awaited<ReturnType<typeof lockServiceOrder>>;

export function isClosedStage(stageType: StageType): boolean {
  return CLOSED_STAGE_TYPES.includes(stageType);
}

export function assertEditable(os: LockedServiceOrder) {
  if (os.sale || isClosedStage(os.column.stageType)) throw conflict('Esta OS está encerrada e não pode mais ser alterada.');
}

export function activeDeposits(os: LockedServiceOrder) {
  return os.payments.filter((payment) => !payment.reversedAt && !payment.saleId);
}

export async function stageColumn(tx: Tx, stageType: StageType, pick: 'first' | 'last' = 'first'): Promise<KanbanColumn> {
  const columns = await tx.kanbanColumn.findMany({ where: { stageType, archived: false }, orderBy: { order: 'asc' } });
  const column = pick === 'first' ? columns[0] : columns.at(-1);
  if (!column) throw conflict(`Não há coluna ativa da etapa "${STAGE_TYPE_LABELS[stageType]}". Ajuste o quadro em Configurações.`);
  return column;
}

export interface EventInput {
  type: OsEventType;
  userId: string | null;
  now: Date;
  fromColumnId?: string | null;
  toColumnId?: string | null;
  data?: Record<string, unknown> | null;
}

export async function addEvent(tx: Tx, serviceOrderId: string, event: EventInput) {
  await tx.serviceOrderEvent.create({
    data: {
      serviceOrderId,
      type: event.type,
      userId: event.userId,
      fromColumnId: event.fromColumnId ?? null,
      toColumnId: event.toColumnId ?? null,
      data: event.data ? (JSON.parse(JSON.stringify(event.data)) as Prisma.InputJsonValue) : undefined,
      createdAt: event.now,
    },
  });
}

function requestedIndex(siblings: { id: string }[], placement: Pick<MoveOptions, 'position' | 'afterId'>) {
  if (placement.afterId === undefined) return placement.position ?? siblings.length;
  if (placement.afterId === null) return 0;
  const anchor = siblings.findIndex((row) => row.id === placement.afterId);
  return anchor === -1 ? siblings.length : anchor + 1;
}

async function placeInColumn(tx: Tx, columnId: string, serviceOrderId: string, placement: Pick<MoveOptions, 'position' | 'afterId'>) {
  const siblings = await tx.serviceOrder.findMany({
    where: { columnId, id: { not: serviceOrderId } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, position: true },
  });
  const index = Math.max(0, Math.min(requestedIndex(siblings, placement), siblings.length));
  const ordered = [...siblings.slice(0, index), { id: serviceOrderId, position: -1 }, ...siblings.slice(index)];
  for (const [next, row] of ordered.entries()) {
    if (row.id === serviceOrderId || row.position === next) continue;
    await tx.serviceOrder.update({ where: { id: row.id }, data: { position: next } });
  }
  return index;
}

export interface MoveOptions {
  userId: string | null;
  now: Date;
  position?: number;
  afterId?: string | null;
  eventType?: OsEventType;
  data?: Record<string, unknown>;
}

export async function moveServiceOrder(tx: Tx, os: { id: string; columnId: string }, target: KanbanColumn, options: MoveOptions) {
  const closing = isClosedStage(target.stageType);
  const sameColumn = os.columnId === target.id;
  const position = closing ? 0 : await placeInColumn(tx, target.id, os.id, options);
  await tx.serviceOrder.update({
    where: { id: os.id },
    data: { columnId: target.id, position, ...(sameColumn ? {} : { columnEnteredAt: options.now, closedAt: closing ? options.now : null }) },
  });
  if (sameColumn) return;
  await addEvent(tx, os.id, {
    type: options.eventType ?? 'moved',
    userId: options.userId,
    now: options.now,
    fromColumnId: os.columnId,
    toColumnId: target.id,
    data: options.data ?? null,
  });
}

export async function nextPosition(tx: Tx, columnId: string) {
  const last = await tx.serviceOrder.findFirst({ where: { columnId }, orderBy: { position: 'desc' }, select: { position: true } });
  return last ? last.position + 1 : 0;
}

export interface ReverseDepositsInput {
  session: Pick<CashSession, 'id'>;
  userId: string;
  approvedById: string | null;
  now: Date;
}

export async function reverseDeposits(tx: Tx, os: LockedServiceOrder, input: ReverseDepositsInput) {
  return reversePayments(tx, {
    session: input.session,
    payments: activeDeposits(os),
    userId: input.userId,
    approvedById: input.approvedById,
    now: input.now,
    ref: { type: 'ServiceOrder', id: os.id, number: os.number },
    description: `Estorno do sinal da OS ${os.number}`,
  });
}

export interface DeliverInput {
  payments: PaymentInput[];
  allowPending: boolean;
  userId: string;
  now: Date;
  config: FeeConfig;
  session: Pick<CashSession, 'id'>;
  ip?: string | null;
  authorizePending: () => Promise<string | null>;
  checkpoint?: (name: string) => void;
}

export async function deliverServiceOrder(tx: Tx, os: LockedServiceOrder, input: DeliverInput) {
  if (os.sale) throw conflict('Esta OS já foi entregue.');
  if (os.column.stageType !== 'ready') throw conflict('Só dá para entregar uma OS que está pronta para retirada.');
  const lines = billableLines(os);
  const products = await lockProducts(tx, lines.map((line) => line.productId));
  const priced = lines.map((line) => {
    const product = line.productId ? products.get(line.productId) : undefined;
    return {
      ...line,
      unitCostCents: product ? product.costCents : line.unitCostCents,
      tracksStock: Boolean(product && product.tracksStock && product.type === 'product'),
    };
  });
  const discountCents = billableDiscount(os);
  const cart = computeCart(
    priced.map((line) => ({ qty: line.qty, unitPriceCents: line.unitPriceCents, unitCostCents: line.unitCostCents })),
    { mode: 'amount', value: discountCents },
  );
  const deposits = activeDeposits(os);
  const depositCents = deposits.reduce((sum, payment) => sum + payment.coveredCents, 0);
  const dueCents = cart.totalCents - depositCents;
  if (dueCents < 0) throw conflict('O sinal recebido é maior que o total da OS. Ajuste o orçamento antes de entregar.');
  if (dueCents === 0 && input.payments.length > 0) throw unprocessable('Não há valor a receber nesta OS.', 'NOTHING_DUE');
  const checkout = checkoutOrThrow(dueCents, input.payments, input.config);
  let approvedById: string | null = null;
  if (checkout.remainingCents > 0) {
    if (!input.allowPending) throw unprocessable(remainingMessage(checkout.remainingCents), 'PAYMENT_INCOMPLETE');
    approvedById = await input.authorizePending();
  }
  const doneColumn = await stageColumn(tx, 'done');
  const paidCents = depositCents + checkout.coveredCents;
  const status = checkout.remainingCents > 0 ? 'pending' : 'completed';
  let sale: { id: string; number: string | null } | null = null;
  if (priced.length > 0) {
    const number = await nextNumber(tx, 'sale');
    sale = await tx.sale.create({
      data: {
        number,
        status,
        origin: 'os',
        serviceOrderId: os.id,
        customerId: os.customerId,
        sellerId: input.userId,
        subtotalCents: cart.grossCents,
        discountCents: cart.discountCents,
        discountMode: cart.discountCents > 0 ? 'amount' : null,
        discountValue: cart.discountCents > 0 ? cart.discountCents : null,
        totalCents: cart.totalCents,
        paidCents,
        costCents: cart.costCents,
        completedAt: input.now,
        approvedById,
      },
      select: { id: true, number: true },
    });
    const saleId = sale.id;
    await tx.saleItem.createMany({
      data: priced.map((line, position) => ({
        saleId,
        productId: line.productId,
        kind: line.kind,
        name: line.name,
        qty: line.qty,
        unitPriceCents: line.unitPriceCents,
        listPriceCents: line.unitPriceCents,
        unitCostCents: line.unitCostCents,
        discountCents: cart.items[position]!.discountCents,
        totalCents: cart.items[position]!.totalCents,
        tracksStock: line.tracksStock,
        position,
      })),
    });
    for (const line of priced) {
      if (!line.productId || !line.tracksStock) continue;
      await applyStockChange(tx, {
        productId: line.productId,
        qty: -line.qty,
        type: 'os_use',
        userId: input.userId,
        refType: 'ServiceOrder',
        refId: os.id,
        refNumber: os.number,
        requireAvailable: true,
      });
    }
    input.checkpoint?.('os.deliver.after_stock');
    if (deposits.length > 0) {
      await tx.payment.updateMany({ where: { id: { in: deposits.map((payment) => payment.id) } }, data: { saleId } });
    }
  }
  await recordPayments(tx, {
    session: input.session,
    lines: checkout.lines,
    saleId: sale?.id ?? null,
    serviceOrderId: os.id,
    userId: input.userId,
    approvedById,
    now: input.now,
    ref: { type: 'ServiceOrder', id: os.id, number: os.number },
    description: `Entrega da OS ${os.number}`,
  });
  input.checkpoint?.('os.deliver.after_payments');
  const warrantyUntil = !isRejected(os) && os.items.length > 0 && os.warrantyDays > 0 ? addDays(input.now, os.warrantyDays) : null;
  await moveServiceOrder(tx, os, doneColumn, {
    userId: input.userId,
    now: input.now,
    eventType: 'delivered',
    data: { saleId: sale?.id ?? null, saleNumber: sale?.number ?? null, receivedCents: checkout.coveredCents, pendingCents: checkout.remainingCents },
  });
  await tx.serviceOrder.update({ where: { id: os.id }, data: { deliveredAt: input.now, warrantyUntil } });
  const summary = { saleNumber: sale?.number ?? null, status, totalCents: cart.totalCents, paidCents, pendingCents: checkout.remainingCents };
  await audit(tx, {
    userId: input.userId,
    approvedById,
    action: 'os.delivered',
    entity: 'ServiceOrder',
    entityId: os.id,
    before: { column: os.column.name },
    after: { column: doneColumn.name, ...summary, warrantyUntil },
    ip: input.ip ?? null,
  });
  if (sale) {
    await audit(tx, {
      userId: input.userId,
      approvedById,
      action: 'sale.completed',
      entity: 'Sale',
      entityId: sale.id,
      after: { number: sale.number, origin: 'os', serviceOrderNumber: os.number, status, totalCents: cart.totalCents, paidCents },
      ip: input.ip ?? null,
    });
  }
  return { saleId: sale?.id ?? null, ...summary };
}

export async function closeOrderOfCancelledSale(tx: Tx, serviceOrderId: string, input: { userId: string; now: Date; saleNumber: string | null; reason: string }) {
  await tx.$queryRaw`SELECT id FROM "ServiceOrder" WHERE id = ${serviceOrderId}::uuid FOR UPDATE`;
  const os = await tx.serviceOrder.findUnique({ where: { id: serviceOrderId }, select: { id: true, columnId: true } });
  if (!os) return;
  const target = await stageColumn(tx, 'cancelled', 'last');
  await moveServiceOrder(tx, os, target, {
    userId: input.userId,
    now: input.now,
    data: { reason: `Venda ${input.saleNumber ?? ''} cancelada: ${input.reason}`.trim() },
  });
  await tx.serviceOrder.update({ where: { id: os.id }, data: { warrantyUntil: null } });
}
