import type { Prisma } from '../generated/prisma/client.ts';
import { pageParams } from '../http/parse.ts';
import type { Router } from '../http/router.ts';
import { periodFromQuery } from '../services/summary.ts';

export function auditRoutes(r: Router) {
  r.get('/api/audit', 'audit.view', async (ctx) => {
    const { skip, take } = pageParams(ctx.query, 50);
    const where: Prisma.AuditLogWhereInput = {};
    if (ctx.query.userId) where.userId = ctx.query.userId;
    if (ctx.query.action) where.action = { startsWith: ctx.query.action };
    if (ctx.query.entity) where.entity = ctx.query.entity;
    if (ctx.query.period) {
      const { range } = periodFromQuery(ctx.query, ctx.deps.clock.now());
      where.createdAt = { gte: range.start, lt: range.end };
    }
    const [rows, total] = await Promise.all([
      ctx.deps.db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      ctx.deps.db.auditLog.count({ where }),
    ]);
    const ids = [...new Set(rows.flatMap((row) => [row.userId, row.approvedById]).filter((id): id is string => Boolean(id)))];
    const users = await ctx.deps.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const names = new Map(users.map((user) => [user.id, user.name]));
    return {
      items: rows.map((row) => ({
        ...row,
        userName: row.userId ? (names.get(row.userId) ?? null) : null,
        approvedByName: row.approvedById ? (names.get(row.approvedById) ?? null) : null,
      })),
      total,
    };
  });

  r.get('/api/audit/users', 'audit.view', async (ctx) => {
    return ctx.deps.db.user.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, active: true } });
  });
}
