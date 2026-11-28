import { dayKey, listDayKeys, PAYMENT_METHODS, summarize, sum, type PeriodRange } from '@loja/shared';
import type { Db } from '../db.ts';
import { toLedger } from './cash.ts';
import { userNames } from './sales.ts';
import { periodSalesWhere } from './summary.ts';

const COMPLETION_STAGES = ['ready', 'done'] as const;

function inRange(range: PeriodRange) {
  return { gte: range.start, lt: range.end };
}

function average(total: number, count: number) {
  return count > 0 ? Math.round(total / count) : 0;
}

export async function saleItemsReport(db: Db, range: PeriodRange) {
  const rows = await db.saleItem.findMany({
    where: { sale: periodSalesWhere(range) },
    orderBy: [{ sale: { completedAt: 'desc' } }, { position: 'asc' }],
    select: {
      id: true,
      productId: true,
      name: true,
      qty: true,
      unitPriceCents: true,
      discountCents: true,
      totalCents: true,
      sale: {
        select: {
          id: true,
          number: true,
          completedAt: true,
          sellerId: true,
          customer: { select: { name: true } },
          serviceOrder: { select: { number: true } },
        },
      },
    },
  });
  const names = await userNames(db, rows.map((row) => row.sale.sellerId));
  return {
    items: rows.map((row) => ({
      id: row.id,
      saleId: row.sale.id,
      saleNumber: row.sale.number,
      completedAt: row.sale.completedAt,
      serviceOrderNumber: row.sale.serviceOrder?.number ?? null,
      productId: row.productId,
      name: row.name,
      qty: row.qty,
      unitPriceCents: row.unitPriceCents,
      discountCents: row.discountCents,
      totalCents: row.totalCents,
      sellerName: names.get(row.sale.sellerId) ?? '',
      customerName: row.sale.customer?.name ?? null,
    })),
  };
}

export async function salesReport(db: Db, range: PeriodRange) {
  const [sales, movements] = await Promise.all([
    db.sale.findMany({
      where: periodSalesWhere(range),
      select: { completedAt: true, totalCents: true, sellerId: true, items: { select: { productId: true, name: true, qty: true, totalCents: true } } },
    }),
    db.cashMovement.findMany({ where: { occurredAt: inRange(range), type: { in: ['payment', 'reversal'] } } }),
  ]);

  const days = new Map(listDayKeys(range).map((key) => [key, { day: key, count: 0, totalCents: 0 }]));
  for (const sale of sales) {
    const bucket = days.get(dayKey(sale.completedAt!));
    if (!bucket) continue;
    bucket.count += 1;
    bucket.totalCents += sale.totalCents;
  }

  const sellers = new Map<string, { sellerId: string; count: number; totalCents: number }>();
  for (const sale of sales) {
    const row = sellers.get(sale.sellerId) ?? { sellerId: sale.sellerId, count: 0, totalCents: 0 };
    row.count += 1;
    row.totalCents += sale.totalCents;
    sellers.set(sale.sellerId, row);
  }
  const names = await userNames(db, [...sellers.keys()]);

  const products = new Map<string, { productId: string | null; name: string; qty: number; totalCents: number }>();
  for (const item of sales.flatMap((sale) => sale.items)) {
    const key = item.productId ?? `free:${item.name.trim().toLowerCase()}`;
    const row = products.get(key) ?? { productId: item.productId, name: item.name, qty: 0, totalCents: 0 };
    row.qty += item.qty;
    row.totalCents += item.totalCents;
    products.set(key, row);
  }

  const ledger = summarize({ movements: movements.map(toLedger), cmvCents: 0, salesCount: 0, salesTotalCents: 0 });
  const count = sales.length;
  const totalCents = sum(sales.map((sale) => sale.totalCents));
  return {
    totals: { count, totalCents, averageTicketCents: average(totalCents, count), receivedCents: ledger.receivedCents },
    byDay: [...days.values()],
    byMethod: ledger.byMethod.filter((row) => row.grossCents !== 0 || row.feeCents !== 0),
    bySeller: [...sellers.values()]
      .map((row) => ({ ...row, name: names.get(row.sellerId) ?? '', averageTicketCents: average(row.totalCents, row.count) }))
      .sort((a, b) => b.totalCents - a.totalCents),
    topProducts: [...products.values()].sort((a, b) => b.qty - a.qty || b.totalCents - a.totalCents),
  };
}

export async function serviceOrderCompletions(db: Db, range: PeriodRange) {
  const columns = await db.kanbanColumn.findMany({ where: { stageType: { in: [...COMPLETION_STAGES] } }, select: { id: true } });
  const columnIds = columns.map((column) => column.id);
  const candidates = await db.serviceOrderEvent.findMany({
    where: { toColumnId: { in: columnIds }, createdAt: inRange(range) },
    select: { serviceOrderId: true },
    distinct: ['serviceOrderId'],
  });
  if (candidates.length === 0) return [];
  const firsts = await db.serviceOrderEvent.groupBy({
    by: ['serviceOrderId'],
    where: { serviceOrderId: { in: candidates.map((row) => row.serviceOrderId) }, toColumnId: { in: columnIds } },
    _min: { createdAt: true },
  });
  const completedAt = new Map(
    firsts.flatMap((row) => {
      const at = row._min.createdAt;
      return at && at >= range.start && at < range.end ? [[row.serviceOrderId, at] as const] : [];
    }),
  );
  const orders = await db.serviceOrder.findMany({ where: { id: { in: [...completedAt.keys()] } }, select: { id: true, technicianId: true, createdAt: true } });
  return orders.map((order) => {
    const at = completedAt.get(order.id)!;
    return { serviceOrderId: order.id, technicianId: order.technicianId, completedAt: at, durationMs: Math.max(0, at.getTime() - order.createdAt.getTime()) };
  });
}

export async function serviceOrderReport(db: Db, range: PeriodRange) {
  const [opened, completions] = await Promise.all([
    db.serviceOrder.groupBy({ by: ['technicianId'], where: { createdAt: inRange(range) }, _count: { _all: true } }),
    serviceOrderCompletions(db, range),
  ]);
  const rows = new Map<string | null, { technicianId: string | null; opened: number; completed: number; durationMs: number }>();
  const rowOf = (technicianId: string | null) => {
    const row = rows.get(technicianId) ?? { technicianId, opened: 0, completed: 0, durationMs: 0 };
    rows.set(technicianId, row);
    return row;
  };
  for (const group of opened) rowOf(group.technicianId).opened += group._count._all;
  for (const completion of completions) {
    const row = rowOf(completion.technicianId);
    row.completed += 1;
    row.durationMs += completion.durationMs;
  }
  const names = await userNames(db, [...rows.keys()]);
  const totalOpened = sum([...rows.values()].map((row) => row.opened));
  const totalDuration = sum(completions.map((completion) => completion.durationMs));
  return {
    totals: { opened: totalOpened, completed: completions.length, averageReadyMs: completions.length > 0 ? average(totalDuration, completions.length) : null },
    byTechnician: [...rows.values()]
      .map((row) => ({
        technicianId: row.technicianId,
        name: row.technicianId ? (names.get(row.technicianId) ?? '') : null,
        opened: row.opened,
        completed: row.completed,
        averageReadyMs: row.completed > 0 ? average(row.durationMs, row.completed) : null,
      }))
      .sort((a, b) => (a.technicianId === null ? 1 : 0) - (b.technicianId === null ? 1 : 0) || b.completed - a.completed || b.opened - a.opened),
  };
}

export async function financeReport(db: Db, range: PeriodRange, options: { withFinance: boolean }) {
  const [movements, sessions] = await Promise.all([
    options.withFinance ? db.cashMovement.findMany({ where: { occurredAt: inRange(range) }, include: { category: { select: { name: true } } } }) : Promise.resolve([]),
    db.cashSession.findMany({ where: { closedAt: inRange(range) }, orderBy: { closedAt: 'asc' } }),
  ]);
  const names = await userNames(db, sessions.flatMap((session) => [session.openedById, session.closedById]));
  const closings = sessions.map((session) => ({
    id: session.id,
    status: session.status,
    openedAt: session.openedAt,
    openedByName: names.get(session.openedById) ?? '',
    closedAt: session.closedAt,
    closedByName: session.closedById ? (names.get(session.closedById) ?? '') : '',
    openingCents: session.openingCents,
    expectedCashCents: session.expectedCashCents,
    countedCashCents: session.countedCashCents,
    differenceCents: session.differenceCents,
    notes: session.notes,
    reopenedAt: session.reopenedAt,
  }));
  if (!options.withFinance) return { costs: null, fees: null, closings };

  const categories = new Map<string, { categoryId: string | null; name: string; count: number; amountCents: number }>();
  for (const movement of movements.filter((row) => row.type === 'expense')) {
    const key = movement.categoryId ?? 'none';
    const row = categories.get(key) ?? { categoryId: movement.categoryId, name: movement.category?.name ?? 'Sem categoria', count: 0, amountCents: 0 };
    row.count += 1;
    row.amountCents += movement.amountCents;
    categories.set(key, row);
  }
  const ledger = summarize({ movements: movements.map(toLedger), cmvCents: 0, salesCount: 0, salesTotalCents: 0 });
  const fees = PAYMENT_METHODS.map((method) => ledger.byMethod.find((row) => row.method === method)!).filter((row) => row.grossCents !== 0 || row.feeCents !== 0);
  return {
    costs: { totalCents: ledger.expenseCents, byCategory: [...categories.values()].sort((a, b) => b.amountCents - a.amountCents) },
    fees: { totalCents: ledger.feeCents, byMethod: fees },
    closings,
  };
}

export async function teamPerformance(db: Db, range: PeriodRange) {
  const [users, sales, completions] = await Promise.all([
    db.user.findMany({ select: { id: true, name: true, active: true, role: { select: { name: true } } }, orderBy: { name: 'asc' } }),
    db.sale.groupBy({ by: ['sellerId'], where: periodSalesWhere(range), _count: { _all: true }, _sum: { totalCents: true } }),
    serviceOrderCompletions(db, range),
  ]);
  const salesBySeller = new Map(sales.map((row) => [row.sellerId, { count: row._count._all, totalCents: row._sum.totalCents ?? 0 }]));
  const completedBy = new Map<string, number>();
  for (const completion of completions) {
    if (completion.technicianId) completedBy.set(completion.technicianId, (completedBy.get(completion.technicianId) ?? 0) + 1);
  }
  return {
    items: users
      .map((user) => {
        const own = salesBySeller.get(user.id) ?? { count: 0, totalCents: 0 };
        return {
          userId: user.id,
          name: user.name,
          roleName: user.role.name,
          active: user.active,
          salesCount: own.count,
          salesTotalCents: own.totalCents,
          averageTicketCents: average(own.totalCents, own.count),
          completedOrders: completedBy.get(user.id) ?? 0,
        };
      })
      .filter((row) => row.active || row.salesCount > 0 || row.completedOrders > 0)
      .sort((a, b) => b.salesTotalCents - a.salesTotalCents || b.completedOrders - a.completedOrders || a.name.localeCompare(b.name, 'pt-BR')),
  };
}
