import type { Router } from '../http/router.ts';
import { financeReport, saleItemsReport, salesReport, serviceOrderReport, teamPerformance } from '../services/reports.ts';
import { periodFromQuery } from '../services/summary.ts';

export function reportRoutes(r: Router) {
  r.get('/api/reports/sales', 'report.view', async (ctx) => {
    const { kind, range } = periodFromQuery(ctx.query, ctx.deps.clock.now(), 'month');
    return { period: { kind, start: range.start, end: range.end }, ...(await salesReport(ctx.deps.db, range)) };
  });

  r.get('/api/reports/sale-items', 'report.view', async (ctx) => {
    const { kind, range } = periodFromQuery(ctx.query, ctx.deps.clock.now(), 'month');
    return { period: { kind, start: range.start, end: range.end }, ...(await saleItemsReport(ctx.deps.db, range)) };
  });

  r.get('/api/reports/service-orders', 'report.view', async (ctx) => {
    const { kind, range } = periodFromQuery(ctx.query, ctx.deps.clock.now(), 'month');
    return { period: { kind, start: range.start, end: range.end }, ...(await serviceOrderReport(ctx.deps.db, range)) };
  });

  r.get('/api/reports/finance', 'report.view', async (ctx) => {
    const { kind, range } = periodFromQuery(ctx.query, ctx.deps.clock.now(), 'month');
    return { period: { kind, start: range.start, end: range.end }, ...(await financeReport(ctx.deps.db, range, { withFinance: ctx.can('finance.view') })) };
  });

  r.get('/api/team/performance', 'team.manage', async (ctx) => {
    const { kind, range } = periodFromQuery(ctx.query, ctx.deps.clock.now(), 'month');
    return { period: { kind, start: range.start, end: range.end }, ...(await teamPerformance(ctx.deps.db, range)) };
  });
}
