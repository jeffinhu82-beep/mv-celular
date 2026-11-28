import { dayKey, hourOf, LATE_STAGE_TYPES, listDayKeys, resolvePeriod, summarize, sum, type PeriodKind, type PeriodRange } from '@loja/shared';
import type { Db } from '../db.ts';
import { fieldError } from '../lib/errors.ts';
import { toLedger } from './cash.ts';
import { serviceOrderBalances } from './receivables.ts';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_KINDS: PeriodKind[] = ['today', 'yesterday', 'month', 'range'];
const OPEN_STAGES = ['entry', 'in_progress', 'ready'] as const;

export function periodFromQuery(query: Record<string, string | undefined>, now: Date, fallback: PeriodKind = 'today') {
  const kind = PERIOD_KINDS.includes(query.period as PeriodKind) ? (query.period as PeriodKind) : fallback;
  for (const key of ['from', 'to'] as const) {
    const value = query[key];
    if (value && (!DAY_KEY.test(value) || Number.isNaN(Date.parse(value)))) throw fieldError(key, 'Data inválida. Use o formato AAAA-MM-DD.');
  }
  const range = resolvePeriod(kind, now, { from: query.from, to: query.to ?? query.from });
  if (range.end <= range.start) throw fieldError('to', 'A data final precisa ser depois da inicial.');
  return { kind, range };
}

export function isSingleDay(range: PeriodRange) {
  return listDayKeys(range).length <= 1;
}

export function periodSalesWhere(range: PeriodRange) {
  return { completedAt: { gte: range.start, lt: range.end }, status: { in: ['completed' as const, 'pending' as const] } };
}

export async function financeSummary(db: Db, range: PeriodRange) {
  const inRange = { gte: range.start, lt: range.end };
  const [movements, cmvSales, sales] = await Promise.all([
    db.cashMovement.findMany({ where: { occurredAt: inRange }, orderBy: { occurredAt: 'asc' } }),
    db.sale.findMany({
      where: { completedAt: { not: null }, OR: [{ completedAt: inRange }, { cancelledAt: inRange }] },
      select: { completedAt: true, cancelledAt: true, costCents: true },
    }),
    db.sale.findMany({ where: periodSalesWhere(range), select: { completedAt: true, totalCents: true } }),
  ]);
  const within = (date: Date | null) => Boolean(date && date >= range.start && date < range.end);
  const cmvEvents = cmvSales.flatMap((sale) => [
    ...(within(sale.completedAt) ? [{ at: sale.completedAt!, cents: sale.costCents }] : []),
    ...(within(sale.cancelledAt) ? [{ at: sale.cancelledAt!, cents: -sale.costCents }] : []),
  ]);
  const summary = summarize({
    movements: movements.map(toLedger),
    cmvCents: sum(cmvEvents.map((event) => event.cents)),
    salesCount: sales.length,
    salesTotalCents: sum(sales.map((sale) => sale.totalCents)),
  });

  const hourly = isSingleDay(range);
  const bucketOf = (date: Date) => (hourly ? String(hourOf(date)).padStart(2, '0') : dayKey(date));
  const keys = hourly ? Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')) : listDayKeys(range);
  const buckets = new Map(keys.map((key) => [key, { key, salesCents: 0, salesCount: 0, receivedCents: 0, resultCents: 0 }]));
  for (const sale of sales) {
    const bucket = buckets.get(bucketOf(sale.completedAt!));
    if (!bucket) continue;
    bucket.salesCents += sale.totalCents;
    bucket.salesCount += 1;
  }
  for (const movement of movements) {
    const bucket = buckets.get(bucketOf(movement.occurredAt));
    if (!bucket) continue;
    const slice = summarize({ movements: [toLedger(movement)], cmvCents: 0, salesCount: 0, salesTotalCents: 0 });
    bucket.receivedCents += slice.receivedCents;
    bucket.resultCents += slice.resultCents;
  }
  for (const event of cmvEvents) {
    const bucket = buckets.get(bucketOf(event.at));
    if (bucket) bucket.resultCents -= event.cents;
  }
  return { summary, chart: { granularity: hourly ? ('hour' as const) : ('day' as const), points: [...buckets.values()] } };
}

function saleLabel(sale: { serviceOrder: { number: string; brand: string; model: string } | null; items: { name: string }[] }) {
  if (sale.serviceOrder) return `${sale.serviceOrder.number} · ${sale.serviceOrder.brand} ${sale.serviceOrder.model}`.trim();
  const [first, ...rest] = sale.items;
  if (!first) return '';
  return rest.length > 0 ? `${first.name} + ${rest.length} ${rest.length === 1 ? 'item' : 'itens'}` : first.name;
}

export async function receivables(db: Db, limit = 8) {
  const [pendingSales, readyOrders] = await Promise.all([
    db.sale.findMany({
      where: { status: 'pending' },
      orderBy: { completedAt: 'asc' },
      select: {
        id: true,
        number: true,
        totalCents: true,
        paidCents: true,
        completedAt: true,
        customer: { select: { id: true, name: true, phoneE164: true } },
        serviceOrder: { select: { number: true, brand: true, model: true } },
        items: { select: { name: true }, orderBy: { position: 'asc' } },
      },
    }),
    db.serviceOrder.findMany({
      where: { column: { stageType: 'ready' }, sale: null },
      orderBy: { columnEnteredAt: 'asc' },
      select: {
        id: true,
        number: true,
        brand: true,
        model: true,
        discountCents: true,
        approvalStatus: true,
        diagnosisFeeCents: true,
        columnEnteredAt: true,
        customer: { select: { id: true, name: true, phoneE164: true } },
        items: { select: { qty: true, unitPriceCents: true } },
        payments: { select: { coveredCents: true, reversedAt: true, saleId: true } },
      },
    }),
  ]);
  const balances = serviceOrderBalances(readyOrders);
  const items = [
    ...pendingSales.map((sale) => ({
      kind: 'sale' as const,
      id: sale.id,
      number: sale.number,
      label: saleLabel(sale),
      customer: sale.customer,
      balanceCents: sale.totalCents - sale.paidCents,
      since: sale.completedAt,
    })),
    ...readyOrders.map((order) => ({
      kind: 'os' as const,
      id: order.id,
      number: order.number,
      label: `${order.brand} ${order.model}`.trim(),
      customer: order.customer,
      balanceCents: balances.get(order.id)?.balanceCents ?? 0,
      since: order.columnEnteredAt,
    })),
  ].filter((item) => item.balanceCents > 0);
  return { totalCents: sum(items.map((item) => item.balanceCents)), count: items.length, items: items.slice(0, limit) };
}

export async function lowStock(db: Db, limit = 8) {
  const where = { active: true, type: 'product' as const, tracksStock: true, stockQty: { lt: db.product.fields.minStock } };
  const [items, count] = await Promise.all([
    db.product.findMany({ where, orderBy: { stockQty: 'asc' }, take: limit, select: { id: true, name: true, sku: true, stockQty: true, minStock: true } }),
    db.product.count({ where }),
  ]);
  return { count, items };
}

export async function serviceOrderOverview(db: Db, now: Date, staleOsDays: number, scope: { userId?: string } = {}) {
  const ownership = scope.userId ? { OR: [{ technicianId: scope.userId }, { createdById: scope.userId }] } : {};
  const open = { column: { stageType: { in: [...OPEN_STAGES] } }, ...ownership };
  const staleBefore = new Date(now.getTime() - staleOsDays * 86400000);
  const [columns, grouped, stale, late] = await Promise.all([
    db.kanbanColumn.findMany({ where: { archived: false, stageType: { in: [...OPEN_STAGES] } }, orderBy: { order: 'asc' } }),
    db.serviceOrder.groupBy({ by: ['columnId'], where: open, _count: { _all: true } }),
    db.serviceOrder.count({ where: { ...open, columnEnteredAt: { lt: staleBefore } } }),
    db.serviceOrder.count({ where: { ...ownership, column: { stageType: { in: LATE_STAGE_TYPES } }, dueAt: { lt: now } } }),
  ]);
  const counts = new Map(grouped.map((row) => [row.columnId, row._count._all]));
  return {
    openCount: sum(grouped.map((row) => row._count._all)),
    staleCount: stale,
    lateCount: late,
    byColumn: columns.map((column) => ({ id: column.id, name: column.name, color: column.color, stageType: column.stageType, count: counts.get(column.id) ?? 0 })),
  };
}
