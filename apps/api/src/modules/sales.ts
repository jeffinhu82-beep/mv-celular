import {
  quoteCreateSchema,
  receivePaymentsSchema,
  saleCancelSchema,
  saleCreateSchema,
  SALE_ORIGINS,
  SALE_STATUSES,
  PAYMENT_METHODS,
  type SaleOrigin,
  type SaleStatus,
  type PaymentMethod,
} from '@loja/shared';
import type { Prisma } from '../generated/prisma/client.ts';
import { failpoint } from '../deps.ts';
import { audit } from '../lib/audit.ts';
import { nextNumber } from '../lib/counter.ts';
import { conflict, fieldError, notFound, unprocessable } from '../lib/errors.ts';
import { pageParams, parse, requireUuid } from '../http/parse.ts';
import type { Ctx, Router } from '../http/router.ts';
import { recordPayments, requireOpenSession, reversePayments } from '../services/cash.ts';
import {
  approvePricing,
  assertStock,
  checkoutOrThrow,
  getSaleDetail,
  lockProducts,
  lockSale,
  priceItems,
  remainingMessage,
  userNames,
} from '../services/sales.ts';
import { getStoreSettings, loadFeeConfig } from '../services/settings.ts';
import { closeOrderOfCancelledSale } from '../services/service-orders.ts';
import { periodFromQuery, receivables } from '../services/summary.ts';
import { applyStockChange } from '../services/stock.ts';

const VIEW_SALES = ['sale.create', 'sale.view_all'] as const;
type QuoteListStatus = 'open' | 'expired' | 'converted' | 'cancelled';
const DAY_MS = 86400000;

function ownScope(ctx: Ctx): Prisma.SaleWhereInput {
  return ctx.can('sale.view_all') ? {} : { sellerId: ctx.user.id };
}

async function assertVisible(ctx: Ctx, id: string) {
  const sale = await ctx.deps.db.sale.findFirst({ where: { id, ...ownScope(ctx) }, select: { id: true } });
  if (!sale) throw notFound('Venda não encontrada.');
}

async function assertCustomer(ctx: Ctx, customerId: string | null) {
  if (!customerId) return;
  const customer = await ctx.deps.db.customer.findUnique({ where: { id: customerId }, select: { anonymizedAt: true } });
  if (!customer || customer.anonymizedAt) throw fieldError('customerId', 'Cliente não encontrado.');
}

async function createSale(ctx: Ctx) {
  const input = parse(saleCreateSchema, ctx.body);
  const config = await loadFeeConfig(ctx.deps.db);
  const now = ctx.deps.clock.now();
  const saleId = await ctx.deps.db.$transaction(async (tx) => {
    const session = await requireOpenSession(tx);
    const quote = input.quoteId ? await lockSale(tx, input.quoteId) : null;
    if (quote && quote.status !== 'quote') throw conflict('Este orçamento já foi convertido ou cancelado.');
    if (quote?.quoteValidUntil && quote.quoteValidUntil < now) throw conflict('Este orçamento venceu. Faça um novo orçamento com os preços de hoje.');
    const customerId = input.customerId ?? quote?.customerId ?? null;
    await assertCustomer(ctx, customerId);
    const products = await lockProducts(tx, input.items.map((item) => item.productId));
    const pricing = priceItems(input.items, products, input.discount);
    const approval = await approvePricing(ctx, pricing);
    await assertStock(tx, pricing.items, products);
    const checkout = checkoutOrThrow(pricing.cart.totalCents, input.payments, config);
    let approvedById = approval.approvedById;
    if (checkout.remainingCents > 0) {
      if (!input.allowPending) throw unprocessable(remainingMessage(checkout.remainingCents), 'PAYMENT_INCOMPLETE');
      if (!customerId) throw fieldError('customerId', 'Escolha o cliente para deixar saldo a receber.');
      const approver = await ctx.approve('sale.allow_pending', 'Deixar saldo a receber precisa de autorização.');
      approvedById = approver?.id ?? approvedById;
    }
    const number = await nextNumber(tx, 'sale');
    const status = checkout.remainingCents > 0 ? 'pending' : 'completed';
    const data = {
      number,
      status,
      origin: 'counter',
      customerId,
      sellerId: quote?.sellerId ?? ctx.user.id,
      subtotalCents: pricing.cart.grossCents,
      discountCents: pricing.cart.discountCents,
      discountMode: input.discount && input.discount.value > 0 ? input.discount.mode : null,
      discountValue: input.discount && input.discount.value > 0 ? input.discount.value : null,
      totalCents: pricing.cart.totalCents,
      paidCents: checkout.coveredCents,
      costCents: pricing.cart.costCents,
      notes: input.notes ?? quote?.notes ?? null,
      completedAt: now,
      approvedById,
    } satisfies Prisma.SaleUncheckedCreateInput;
    let sale;
    if (quote) {
      await tx.saleItem.deleteMany({ where: { saleId: quote.id } });
      sale = await tx.sale.update({ where: { id: quote.id }, data });
    } else {
      sale = await tx.sale.create({ data });
    }
    await tx.saleItem.createMany({ data: pricing.items.map((item) => ({ ...item, saleId: sale.id })) });
    for (const item of pricing.items) {
      if (!item.productId || !item.tracksStock) continue;
      await applyStockChange(tx, {
        productId: item.productId,
        qty: -item.qty,
        type: 'sale',
        userId: ctx.user.id,
        refType: 'Sale',
        refId: sale.id,
        refNumber: number,
        requireAvailable: true,
      });
    }
    failpoint(ctx.deps, 'sale.after_stock');
    await recordPayments(tx, {
      session,
      lines: checkout.lines,
      saleId: sale.id,
      userId: ctx.user.id,
      approvedById,
      now,
      ref: { type: 'Sale', id: sale.id, number },
      description: `Venda ${number}`,
    });
    failpoint(ctx.deps, 'sale.after_payments');
    await audit(tx, {
      userId: ctx.user.id,
      approvedById,
      action: quote ? 'quote.converted' : 'sale.completed',
      entity: 'Sale',
      entityId: sale.id,
      after: { number, quoteNumber: quote?.quoteNumber ?? null, status, totalCents: sale.totalCents, paidCents: sale.paidCents },
      ip: ctx.ip,
    });
    if (approval.overLimit) {
      await audit(tx, {
        userId: ctx.user.id,
        approvedById,
        action: 'sale.discount_over_limit',
        entity: 'Sale',
        entityId: sale.id,
        after: { number, discountCents: pricing.cart.discountCents, effectiveDiscountBps: pricing.cart.effectiveDiscountBps, limitBps: ctx.user.discountLimitBps },
        ip: ctx.ip,
      });
    }
    if (pricing.overrides.length > 0) {
      await audit(tx, {
        userId: ctx.user.id,
        approvedById,
        action: 'sale.price_override',
        entity: 'Sale',
        entityId: sale.id,
        after: { number, items: pricing.overrides },
        ip: ctx.ip,
      });
    }
    return sale.id;
  });
  return getSaleDetail(ctx.deps.db, saleId);
}

async function createQuote(ctx: Ctx) {
  const input = parse(quoteCreateSchema, ctx.body);
  const settings = await getStoreSettings(ctx.deps.db);
  const now = ctx.deps.clock.now();
  await assertCustomer(ctx, input.customerId);
  const quoteId = await ctx.deps.db.$transaction(async (tx) => {
    const ids = [...new Set(input.items.map((item) => item.productId).filter((id): id is string => Boolean(id)))];
    const rows = await tx.product.findMany({ where: { id: { in: ids } } });
    const pricing = priceItems(input.items, new Map(rows.map((row) => [row.id, row])), input.discount);
    const approval = await approvePricing(ctx, pricing);
    const quoteNumber = await nextNumber(tx, 'quote');
    const validityDays = input.validityDays ?? settings.quoteValidityDays;
    const quote = await tx.sale.create({
      data: {
        quoteNumber,
        status: 'quote',
        origin: 'counter',
        customerId: input.customerId,
        sellerId: ctx.user.id,
        subtotalCents: pricing.cart.grossCents,
        discountCents: pricing.cart.discountCents,
        discountMode: input.discount && input.discount.value > 0 ? input.discount.mode : null,
        discountValue: input.discount && input.discount.value > 0 ? input.discount.value : null,
        totalCents: pricing.cart.totalCents,
        costCents: pricing.cart.costCents,
        notes: input.notes,
        quoteCreatedAt: now,
        quoteValidUntil: new Date(now.getTime() + validityDays * DAY_MS),
        approvedById: approval.approvedById,
      },
    });
    await tx.saleItem.createMany({ data: pricing.items.map((item) => ({ ...item, saleId: quote.id })) });
    await audit(tx, {
      userId: ctx.user.id,
      approvedById: approval.approvedById,
      action: 'quote.created',
      entity: 'Sale',
      entityId: quote.id,
      after: { quoteNumber, totalCents: quote.totalCents, validityDays },
      ip: ctx.ip,
    });
    if (approval.overLimit) {
      await audit(tx, {
        userId: ctx.user.id,
        approvedById: approval.approvedById,
        action: 'sale.discount_over_limit',
        entity: 'Sale',
        entityId: quote.id,
        after: { quoteNumber, discountCents: pricing.cart.discountCents, effectiveDiscountBps: pricing.cart.effectiveDiscountBps },
        ip: ctx.ip,
      });
    }
    return quote.id;
  });
  return getSaleDetail(ctx.deps.db, quoteId);
}

async function cancelSale(ctx: Ctx) {
  const id = requireUuid(ctx.params.id);
  const input = parse(saleCancelSchema, ctx.body);
  const now = ctx.deps.clock.now();
  await ctx.deps.db.$transaction(async (tx) => {
    const sale = await lockSale(tx, id);
    if (sale.status === 'cancelled') throw conflict('Esta venda já foi cancelada.');
    const label = sale.number ?? sale.quoteNumber ?? '';
    let reversed = { amountCents: 0, feeCents: 0 };
    if (sale.status !== 'quote') {
      const session = await requireOpenSession(tx);
      for (const item of sale.items) {
        if (!item.productId || !item.tracksStock) continue;
        await applyStockChange(tx, {
          productId: item.productId,
          qty: item.qty,
          type: 'reversal',
          userId: ctx.user.id,
          unitCostCents: item.unitCostCents,
          reason: input.reason,
          refType: 'Sale',
          refId: sale.id,
          refNumber: label,
        });
      }
      failpoint(ctx.deps, 'cancel.after_stock');
      const payments = await tx.payment.findMany({ where: { saleId: sale.id, reversedAt: null } });
      reversed = await reversePayments(tx, {
        session,
        payments,
        userId: ctx.user.id,
        approvedById: ctx.approver?.id ?? null,
        now,
        ref: { type: 'Sale', id: sale.id, number: label },
        description: `Estorno da venda ${label}`,
      });
      failpoint(ctx.deps, 'cancel.after_reversal');
    }
    await tx.sale.update({
      where: { id },
      data: { status: 'cancelled', cancelReason: input.reason, cancelledAt: now, cancelledById: ctx.user.id },
    });
    if (sale.origin === 'os' && sale.serviceOrderId) {
      await closeOrderOfCancelledSale(tx, sale.serviceOrderId, { userId: ctx.user.id, now, saleNumber: sale.number, reason: input.reason });
    }
    await audit(tx, {
      userId: ctx.user.id,
      approvedById: ctx.approver?.id ?? null,
      action: sale.status === 'quote' ? 'quote.cancelled' : 'sale.cancelled',
      entity: 'Sale',
      entityId: id,
      before: { status: sale.status },
      after: { status: 'cancelled', reason: input.reason, reversedCents: reversed.amountCents, reversedFeeCents: reversed.feeCents },
      ip: ctx.ip,
    });
  });
  return getSaleDetail(ctx.deps.db, id);
}

async function receiveBalance(ctx: Ctx) {
  const id = requireUuid(ctx.params.id);
  const input = parse(receivePaymentsSchema, ctx.body);
  const config = await loadFeeConfig(ctx.deps.db);
  const now = ctx.deps.clock.now();
  await ctx.deps.db.$transaction(async (tx) => {
    const session = await requireOpenSession(tx);
    const sale = await lockSale(tx, id);
    if (sale.status !== 'pending') throw conflict('Esta venda não tem saldo a receber.');
    const balance = sale.totalCents - sale.paidCents;
    const checkout = checkoutOrThrow(balance, input.payments, config);
    const paidCents = sale.paidCents + checkout.coveredCents;
    const status = paidCents >= sale.totalCents ? 'completed' : 'pending';
    await recordPayments(tx, {
      session,
      lines: checkout.lines,
      saleId: sale.id,
      serviceOrderId: sale.serviceOrderId,
      userId: ctx.user.id,
      now,
      ref: { type: 'Sale', id: sale.id, number: sale.number },
      description: `Saldo da venda ${sale.number ?? ''}`.trim(),
    });
    failpoint(ctx.deps, 'receive.after_payments');
    await tx.sale.update({ where: { id }, data: { paidCents, status } });
    await audit(tx, {
      userId: ctx.user.id,
      action: 'sale.payment_received',
      entity: 'Sale',
      entityId: id,
      before: { paidCents: sale.paidCents, status: sale.status },
      after: { paidCents, status, receivedCents: checkout.coveredCents },
      ip: ctx.ip,
    });
  });
  return getSaleDetail(ctx.deps.db, id);
}

function listWhere(ctx: Ctx) {
  const query = ctx.query;
  const where: Prisma.SaleWhereInput = { status: { not: 'quote' }, number: { not: null }, ...ownScope(ctx) };
  const period = query.period || query.from || query.to ? periodFromQuery(query, ctx.deps.clock.now(), 'range') : null;
  if (period) where.completedAt = { gte: period.range.start, lt: period.range.end };
  if (query.status && (SALE_STATUSES as readonly string[]).includes(query.status) && query.status !== 'quote') {
    where.status = query.status as SaleStatus;
  }
  if (query.origin && (SALE_ORIGINS as readonly string[]).includes(query.origin)) where.origin = query.origin as SaleOrigin;
  if (query.sellerId && ctx.can('sale.view_all')) where.sellerId = query.sellerId;
  if (query.method && (PAYMENT_METHODS as readonly string[]).includes(query.method)) {
    where.payments = { some: { method: query.method as PaymentMethod } };
  }
  const term = query.q?.trim();
  if (term) {
    where.OR = [
      { number: { contains: term, mode: 'insensitive' } },
      { customer: { name: { contains: term, mode: 'insensitive' } } },
    ];
  }
  return { where, period: period && { kind: period.kind, start: period.range.start, end: period.range.end } };
}

const LIST_INCLUDE = {
  customer: { select: { id: true, name: true } },
  payments: { select: { method: true, installments: true, reversedAt: true } },
  serviceOrder: { select: { id: true, number: true } },
} satisfies Prisma.SaleInclude;

type ListSale = Prisma.SaleGetPayload<{ include: typeof LIST_INCLUDE }>;

function listRow(row: ListSale, names: Map<string, string>) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    origin: row.origin,
    customer: row.customer,
    serviceOrder: row.serviceOrder,
    sellerName: names.get(row.sellerId) ?? '',
    totalCents: row.totalCents,
    paidCents: row.paidCents,
    balanceCents: row.status === 'pending' ? row.totalCents - row.paidCents : 0,
    methods: [...new Set(row.payments.map((payment) => payment.method))],
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
  };
}

export function saleRoutes(r: Router) {
  r.get('/api/sales', [...VIEW_SALES], async (ctx) => {
    const { skip, take } = pageParams(ctx.query, 50);
    const { where } = listWhere(ctx);
    const [rows, total, totals] = await Promise.all([
      ctx.deps.db.sale.findMany({ where, orderBy: { completedAt: 'desc' }, skip, take, include: LIST_INCLUDE }),
      ctx.deps.db.sale.count({ where }),
      ctx.deps.db.sale.aggregate({ where: { AND: [where, { status: { in: ['completed', 'pending'] } }] }, _sum: { totalCents: true }, _count: true }),
    ]);
    const names = await userNames(ctx.deps.db, rows.map((row) => row.sellerId));
    return {
      total,
      totalCents: totals._sum.totalCents ?? 0,
      validCount: totals._count,
      items: rows.map((row) => listRow(row, names)),
    };
  });

  r.get('/api/sales/export', [...VIEW_SALES], async (ctx) => {
    const { where, period } = listWhere(ctx);
    const rows = await ctx.deps.db.sale.findMany({
      where,
      orderBy: { completedAt: 'desc' },
      include: { ...LIST_INCLUDE, items: { select: { name: true, qty: true }, orderBy: { position: 'asc' } } },
    });
    const names = await userNames(ctx.deps.db, rows.map((row) => row.sellerId));
    return {
      period,
      items: rows.map((row) => ({ ...listRow(row, names), discountCents: row.discountCents, items: row.items })),
    };
  });

  r.get('/api/sales/:id', [...VIEW_SALES], async (ctx) => {
    const id = requireUuid(ctx.params.id);
    await assertVisible(ctx, id);
    return getSaleDetail(ctx.deps.db, id);
  });

  r.post('/api/sales', 'sale.create', createSale);
  r.post('/api/sales/:id/payments', 'sale.create', receiveBalance);
  r.get('/api/receivables', 'sale.create', (ctx) => receivables(ctx.deps.db, 500));
  r.post('/api/sales/:id/cancel', 'sale.cancel', cancelSale, { approvable: true });

  r.get('/api/quotes', [...VIEW_SALES], async (ctx) => {
    const { skip, take } = pageParams(ctx.query, 50);
    const now = ctx.deps.clock.now();
    const where: Prisma.SaleWhereInput = { quoteNumber: { not: null }, ...ownScope(ctx) };
    const filter = ctx.query.status as QuoteListStatus | undefined;
    if (filter === 'open') Object.assign(where, { status: 'quote', quoteValidUntil: { gte: now } });
    else if (filter === 'expired') Object.assign(where, { status: 'quote', quoteValidUntil: { lt: now } });
    else if (filter === 'converted') Object.assign(where, { number: { not: null } });
    else if (filter === 'cancelled') Object.assign(where, { status: 'cancelled', number: null });
    const term = ctx.query.q?.trim();
    if (term) {
      where.OR = [
        { quoteNumber: { contains: term, mode: 'insensitive' } },
        { number: { contains: term, mode: 'insensitive' } },
        { customer: { name: { contains: term, mode: 'insensitive' } } },
      ];
    }
    const [rows, total] = await Promise.all([
      ctx.deps.db.sale.findMany({
        where,
        orderBy: { quoteCreatedAt: 'desc' },
        skip,
        take,
        include: { customer: { select: { id: true, name: true, phoneE164: true } }, _count: { select: { items: true } } },
      }),
      ctx.deps.db.sale.count({ where }),
    ]);
    const names = await userNames(ctx.deps.db, rows.map((row) => row.sellerId));
    return {
      total,
      items: rows.map((row) => {
        const expired = row.status === 'quote' && Boolean(row.quoteValidUntil && row.quoteValidUntil < now);
        const status: QuoteListStatus = row.number ? 'converted' : row.status === 'cancelled' ? 'cancelled' : expired ? 'expired' : 'open';
        return {
          id: row.id,
          quoteNumber: row.quoteNumber,
          status,
          saleNumber: row.number,
          customer: row.customer,
          sellerName: names.get(row.sellerId) ?? '',
          totalCents: row.totalCents,
          itemsCount: row._count.items,
          quoteCreatedAt: row.quoteCreatedAt,
          quoteValidUntil: row.quoteValidUntil,
          expired,
        };
      }),
    };
  });

  r.post('/api/quotes', 'sale.create', createQuote);
}
