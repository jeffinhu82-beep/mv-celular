import { isLate, resolvePeriod, sum } from '@loja/shared';
import type { Router } from '../http/router.ts';
import { findOpenSession, sessionExpected } from '../services/cash.ts';
import { userNames } from '../services/sales.ts';
import { getStoreSettings } from '../services/settings.ts';
import { financeSummary, lowStock, periodFromQuery, receivables, serviceOrderOverview } from '../services/summary.ts';

const HOME_LIST_SIZE = 5;

export function dashboardRoutes(r: Router) {
  r.get('/api/dashboard', 'auth', async (ctx) => {
    const db = ctx.deps.db;
    const now = ctx.deps.clock.now();
    const settings = await getStoreSettings(db);

    if (!ctx.can('finance.view')) {
      const today = resolvePeriod('today', now);
      const [sales, orders] = await Promise.all([
        db.sale.findMany({
          where: { sellerId: ctx.user.id, completedAt: { gte: today.start, lt: today.end }, status: { in: ['completed', 'pending'] } },
          orderBy: { completedAt: 'desc' },
          select: { id: true, number: true, status: true, totalCents: true, completedAt: true, customer: { select: { id: true, name: true } } },
        }),
        db.serviceOrder.findMany({
          where: {
            column: { stageType: { in: ['entry', 'in_progress', 'ready'] } },
            OR: [{ technicianId: ctx.user.id }, { createdById: ctx.user.id }],
          },
          orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
          take: 20,
          select: {
            id: true,
            number: true,
            brand: true,
            model: true,
            dueAt: true,
            columnEnteredAt: true,
            customer: { select: { id: true, name: true } },
            column: { select: { name: true, color: true, stageType: true } },
          },
        }),
      ]);
      const overview = await serviceOrderOverview(db, now, settings.staleOsDays, { userId: ctx.user.id });
      return {
        mode: 'reduced' as const,
        period: { kind: 'today' as const, start: today.start, end: today.end },
        mySales: {
          count: sales.length,
          totalCents: sum(sales.map((sale) => sale.totalCents)),
          items: sales.map((sale) => ({
            id: sale.id,
            number: sale.number,
            status: sale.status,
            totalCents: sale.totalCents,
            completedAt: sale.completedAt,
            customerName: sale.customer?.name ?? null,
          })),
        },
        myOrders: {
          staleCount: overview.staleCount,
          lateCount: overview.lateCount,
          items: orders.map((order) => ({
            id: order.id,
            number: order.number,
            device: `${order.brand} ${order.model}`.trim(),
            customerName: order.customer.name,
            columnName: order.column.name,
            columnColor: order.column.color,
            dueAt: order.dueAt,
            late: isLate(order.column.stageType, order.dueAt, now),
            stale: order.columnEnteredAt.getTime() < now.getTime() - settings.staleOsDays * 86400000,
          })),
        },
      };
    }

    const { kind, range } = periodFromQuery(ctx.query, now);
    const [finance, pending, stock, orders, latest, session] = await Promise.all([
      financeSummary(db, range),
      receivables(db, HOME_LIST_SIZE),
      lowStock(db, HOME_LIST_SIZE),
      serviceOrderOverview(db, now, settings.staleOsDays),
      db.sale.findMany({
        where: { status: { not: 'quote' } },
        orderBy: { completedAt: 'desc' },
        take: HOME_LIST_SIZE,
        select: {
          id: true,
          number: true,
          status: true,
          origin: true,
          totalCents: true,
          completedAt: true,
          sellerId: true,
          customer: { select: { id: true, name: true } },
        },
      }),
      findOpenSession(db),
    ]);
    const names = await userNames(db, [...latest.map((sale) => sale.sellerId), session?.openedById]);
    const drawer = session
      ? {
          sessionId: session.id,
          openedAt: session.openedAt,
          openedByName: names.get(session.openedById) ?? '',
          expectedCashCents: (await sessionExpected(db, session)).expected.cash,
        }
      : null;
    return {
      mode: 'full' as const,
      period: { kind, start: range.start, end: range.end },
      summary: finance.summary,
      chart: finance.chart,
      drawer,
      receivables: pending,
      lowStock: stock,
      serviceOrders: orders,
      latestSales: latest.map((sale) => ({
        id: sale.id,
        number: sale.number,
        status: sale.status,
        origin: sale.origin,
        totalCents: sale.totalCents,
        completedAt: sale.completedAt,
        customerName: sale.customer?.name ?? null,
        sellerName: names.get(sale.sellerId) ?? '',
      })),
    };
  });
}
