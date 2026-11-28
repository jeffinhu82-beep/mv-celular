import { cashCloseSchema, cashMovementSchema, cashOpenSchema, cashReopenSchema, closeCash } from '@loja/shared';
import { Prisma, type CashSession } from '../generated/prisma/client.ts';
import type { Db } from '../db.ts';
import { failpoint } from '../deps.ts';
import { audit } from '../lib/audit.ts';
import { conflict, fieldError, notFound } from '../lib/errors.ts';
import { pageParams, parse, requireUuid } from '../http/parse.ts';
import type { Ctx, Router } from '../http/router.ts';
import { findOpenSession, lockSessionSlot, requireOpenSession, sessionExpected } from '../services/cash.ts';
import { userNames } from '../services/sales.ts';

const VIEW_CASH = ['cash.open_close', 'cash.income', 'cash.withdrawal_expense', 'finance.view'] as const;

async function presentSession(db: Db, session: CashSession) {
  const { movements, expected } = await sessionExpected(db, session);
  const names = await userNames(db, [
    session.openedById,
    session.closedById,
    session.reopenedById,
    ...movements.flatMap((movement) => [movement.userId, movement.approvedById]),
  ]);
  const categories = await db.expenseCategory.findMany({ select: { id: true, name: true } });
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  return {
    ...session,
    openedByName: names.get(session.openedById) ?? '',
    closedByName: session.closedById ? (names.get(session.closedById) ?? null) : null,
    reopenedByName: session.reopenedById ? (names.get(session.reopenedById) ?? null) : null,
    expectedNow: expected,
    movements: movements.map((movement) => ({
      ...movement,
      userName: names.get(movement.userId) ?? '',
      approvedByName: movement.approvedById ? (names.get(movement.approvedById) ?? null) : null,
      categoryName: movement.categoryId ? (categoryNames.get(movement.categoryId) ?? null) : null,
    })),
  };
}

type MovementKind = 'income' | 'supply' | 'withdrawal' | 'expense';

async function registerMovement(ctx: Ctx, allowed: MovementKind[]) {
  const input = parse(cashMovementSchema, ctx.body);
  if (!allowed.includes(input.type)) throw fieldError('type', 'Tipo de movimentação inválido para esta ação.');
  const now = ctx.deps.clock.now();
  const method = input.type === 'supply' || input.type === 'withdrawal' ? 'cash' : input.method;
  const fromDrawer = input.type === 'expense' ? input.fromDrawer && method === 'cash' : method === 'cash';
  return ctx.deps.db.$transaction(async (tx) => {
    const session = await requireOpenSession(tx);
    if (input.type === 'expense') {
      const category = await tx.expenseCategory.findUnique({ where: { id: input.categoryId! } });
      if (!category || !category.active) throw fieldError('categoryId', 'Escolha uma categoria ativa.');
    }
    const movement = await tx.cashMovement.create({
      data: {
        sessionId: session.id,
        type: input.type,
        method,
        amountCents: input.amountCents,
        feeCents: 0,
        fromDrawer,
        categoryId: input.type === 'expense' ? input.categoryId : null,
        description: input.description,
        userId: ctx.user.id,
        approvedById: ctx.approver?.id ?? null,
        occurredAt: now,
      },
    });
    if (input.type === 'withdrawal' || input.type === 'expense') {
      await audit(tx, {
        userId: ctx.user.id,
        approvedById: ctx.approver?.id ?? null,
        action: input.type === 'withdrawal' ? 'cash.withdrawal' : 'cash.expense',
        entity: 'CashMovement',
        entityId: movement.id,
        after: movement,
        ip: ctx.ip,
      });
    }
    return movement;
  });
}

export function cashRoutes(r: Router) {
  r.get('/api/cash/status', 'auth', async (ctx) => {
    const session = await findOpenSession(ctx.deps.db);
    if (!session) return { session: null };
    const names = await userNames(ctx.deps.db, [session.openedById]);
    return { session: { id: session.id, openedAt: session.openedAt, openedByName: names.get(session.openedById) ?? '' } };
  });

  r.get('/api/cash/current', [...VIEW_CASH], async (ctx) => {
    const session = await findOpenSession(ctx.deps.db);
    if (!session) return { session: null };
    return { session: await presentSession(ctx.deps.db, session) };
  });

  r.post('/api/cash/open', 'cash.open_close', async (ctx) => {
    const input = parse(cashOpenSchema, ctx.body);
    const now = ctx.deps.clock.now();
    return ctx.deps.db.$transaction(async (tx) => {
      await lockSessionSlot(tx);
      const open = await findOpenSession(tx);
      if (open) throw conflict('Já existe um caixa aberto.');
      const session = await tx.cashSession.create({
        data: { status: 'open', openedById: ctx.user.id, openedAt: now, openingCents: input.openingCents },
      });
      await audit(tx, { userId: ctx.user.id, action: 'cash.opened', entity: 'CashSession', entityId: session.id, after: session, ip: ctx.ip });
      return session;
    });
  });

  r.post('/api/cash/entries', 'cash.income', (ctx) => registerMovement(ctx, ['income', 'supply']));
  r.post('/api/cash/withdrawals', 'cash.withdrawal_expense', (ctx) => registerMovement(ctx, ['withdrawal']), { approvable: true });
  r.post('/api/cash/expenses', 'cash.withdrawal_expense', (ctx) => registerMovement(ctx, ['expense']), { approvable: true });

  r.post('/api/cash/close', 'cash.open_close', async (ctx) => {
    const input = parse(cashCloseSchema, ctx.body);
    const now = ctx.deps.clock.now();
    const closedId = await ctx.deps.db.$transaction(async (tx) => {
      const session = await requireOpenSession(tx, 'update');
      const { expected } = await sessionExpected(tx, session);
      const closing = closeCash(expected.cash, input.countedCashCents);
      if (closing.requiresNote && !input.notes) {
        throw fieldError('notes', 'Explique a diferença entre o contado e o esperado.');
      }
      failpoint(ctx.deps, 'cash.close.before_update');
      const closed = await tx.cashSession.update({
        where: { id: session.id },
        data: {
          status: 'closed',
          closedById: ctx.user.id,
          closedAt: now,
          countedCashCents: closing.countedCashCents,
          expectedCashCents: closing.expectedCashCents,
          expected,
          differenceCents: closing.differenceCents,
          notes: input.notes,
        },
      });
      await audit(tx, {
        userId: ctx.user.id,
        action: 'cash.closed',
        entity: 'CashSession',
        entityId: session.id,
        before: { status: 'open' },
        after: { expected, ...closing, notes: input.notes },
        ip: ctx.ip,
      });
      return closed.id;
    });
    const session = await ctx.deps.db.cashSession.findUniqueOrThrow({ where: { id: closedId } });
    return presentSession(ctx.deps.db, session);
  });

  r.post(
    '/api/cash/sessions/:id/reopen',
    'cash.reopen',
    async (ctx) => {
      const id = requireUuid(ctx.params.id);
      const input = parse(cashReopenSchema, ctx.body);
      const now = ctx.deps.clock.now();
      return ctx.deps.db.$transaction(async (tx) => {
        await lockSessionSlot(tx);
        const session = await tx.cashSession.findUnique({ where: { id } });
        if (!session) throw notFound('Caixa não encontrado.');
        if (session.status !== 'closed') throw conflict('Este caixa já está aberto.');
        if (await findOpenSession(tx)) throw conflict('Feche o caixa aberto antes de reabrir outro.');
        const latest = await tx.cashSession.findFirst({ orderBy: { openedAt: 'desc' } });
        if (latest?.id !== id) throw conflict('Só o último caixa fechado pode ser reaberto.');
        const reopened = await tx.cashSession.update({
          where: { id },
          data: {
            status: 'open',
            closedAt: null,
            closedById: null,
            countedCashCents: null,
            expectedCashCents: null,
            expected: Prisma.DbNull,
            differenceCents: null,
            reopenedAt: now,
            reopenedById: ctx.user.id,
            reopenReason: input.reason,
          },
        });
        await audit(tx, {
          userId: ctx.user.id,
          approvedById: ctx.approver?.id ?? null,
          action: 'cash.reopened',
          entity: 'CashSession',
          entityId: id,
          before: session,
          after: { reason: input.reason },
          ip: ctx.ip,
        });
        return reopened;
      });
    },
    { approvable: true },
  );

  r.get('/api/cash/sessions', [...VIEW_CASH], async (ctx) => {
    const { skip, take } = pageParams(ctx.query, 30);
    const [rows, total] = await Promise.all([
      ctx.deps.db.cashSession.findMany({ orderBy: { openedAt: 'desc' }, skip, take }),
      ctx.deps.db.cashSession.count(),
    ]);
    const names = await userNames(ctx.deps.db, rows.flatMap((row) => [row.openedById, row.closedById]));
    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        openedAt: row.openedAt,
        closedAt: row.closedAt,
        openingCents: row.openingCents,
        expectedCashCents: row.expectedCashCents,
        countedCashCents: row.countedCashCents,
        differenceCents: row.differenceCents,
        notes: row.notes,
        reopenedAt: row.reopenedAt,
        openedByName: names.get(row.openedById) ?? '',
        closedByName: row.closedById ? (names.get(row.closedById) ?? null) : null,
      })),
    };
  });

  r.get('/api/cash/sessions/:id', [...VIEW_CASH], async (ctx) => {
    const session = await ctx.deps.db.cashSession.findUnique({ where: { id: requireUuid(ctx.params.id) } });
    if (!session) throw notFound('Caixa não encontrado.');
    return presentSession(ctx.deps.db, session);
  });
}
