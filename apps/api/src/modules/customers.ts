import { customerSchema, normalizePhoneBR, onlyDigits, quickCustomerSchema } from '@loja/shared';
import type { Prisma } from '../generated/prisma/client.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { pageParams, parse, requireUuid } from '../http/parse.ts';
import type { Router } from '../http/router.ts';
import { serviceOrderBalances } from '../services/receivables.ts';
import { serviceOrderScope } from '../services/service-orders.ts';

function searchWhere(q: string | undefined): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = { anonymizedAt: null };
  const term = q?.trim();
  if (!term) return where;
  const digits = onlyDigits(term);
  const or: Prisma.CustomerWhereInput[] = [{ name: { contains: term, mode: 'insensitive' } }];
  if (digits.length >= 3) {
    or.push({ phoneE164: { contains: digits } }, { cpf: { contains: digits } });
  }
  return { ...where, OR: or };
}

async function duplicatesByPhone(r: Router, phoneE164: string, exceptId?: string) {
  return r.deps.db.customer.findMany({
    where: { phoneE164, anonymizedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true },
    take: 5,
  });
}

export function customerRoutes(r: Router) {
  r.get('/api/customers', 'auth', async (ctx) => {
    const { skip, take } = pageParams(ctx.query, 30);
    const where = searchWhere(ctx.query.q);
    const [items, total] = await Promise.all([
      ctx.deps.db.customer.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
      ctx.deps.db.customer.count({ where }),
    ]);
    return { items, total };
  });

  r.get('/api/customers/check-phone', 'auth', async (ctx) => {
    const phone = normalizePhoneBR(ctx.query.phone ?? '');
    if (!phone) return { duplicates: [] };
    return { duplicates: await duplicatesByPhone(r, phone, ctx.query.exceptId || undefined) };
  });

  r.get('/api/customers/:id', 'auth', async (ctx) => {
    const id = requireUuid(ctx.params.id);
    const customer = await ctx.deps.db.customer.findUnique({ where: { id } });
    if (!customer) throw notFound('Cliente não encontrado.');
    const ownSalesOnly = !ctx.can('sale.view_all');
    const [sales, serviceOrders] = await Promise.all([
      ctx.deps.db.sale.findMany({
        where: { customerId: id, status: { not: 'quote' }, ...(ownSalesOnly ? { sellerId: ctx.user.id } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, number: true, status: true, origin: true, totalCents: true, paidCents: true, completedAt: true, createdAt: true },
      }),
      ctx.deps.db.serviceOrder.findMany({
        where: { AND: [{ customerId: id }, serviceOrderScope(ctx)] },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          column: { select: { name: true, stageType: true, color: true } },
          items: true,
          payments: true,
          sale: { select: { totalCents: true, paidCents: true, status: true } },
        },
      }),
    ]);
    const now = ctx.deps.clock.now();
    const totalSpentCents = sales
      .filter((sale) => sale.status === 'completed' || sale.status === 'pending')
      .reduce((sum, sale) => sum + sale.paidCents, 0);
    const pendingSalesCents = sales
      .filter((sale) => sale.status === 'pending')
      .reduce((sum, sale) => sum + (sale.totalCents - sale.paidCents), 0);
    const osBalances = serviceOrderBalances(serviceOrders);
    const pendingOsCents = serviceOrders
      .filter((os) => os.column.stageType === 'ready' && !os.sale)
      .reduce((sum, os) => sum + Math.max(0, osBalances.get(os.id)?.balanceCents ?? 0), 0);
    return {
      customer,
      sales,
      serviceOrders: serviceOrders.map((os) => ({
        id: os.id,
        number: os.number,
        device: `${os.brand} ${os.model}`.trim(),
        reportedIssue: os.reportedIssue,
        column: os.column,
        totalCents: os.sale ? os.sale.totalCents : (osBalances.get(os.id)?.totalCents ?? 0),
        balanceCents: os.sale
          ? os.sale.status === 'pending'
            ? os.sale.totalCents - os.sale.paidCents
            : 0
          : ['entry', 'in_progress', 'ready'].includes(os.column.stageType)
            ? Math.max(0, osBalances.get(os.id)?.balanceCents ?? 0)
            : 0,
        deliveredAt: os.deliveredAt,
        warrantyUntil: os.warrantyUntil,
        createdAt: os.createdAt,
      })),
      totals: {
        totalSpentCents,
        pendingCents: pendingSalesCents + pendingOsCents,
        activeWarranties: serviceOrders.filter((os) => os.warrantyUntil && os.warrantyUntil > now).length,
      },
    };
  });

  r.post('/api/customers', 'customer.manage', async (ctx) => {
    const input = parse(customerSchema, ctx.body);
    const duplicates = await duplicatesByPhone(r, input.phone);
    const customer = await ctx.deps.db.customer.create({
      data: { name: input.name, phoneE164: input.phone, cpf: input.cpf, email: input.email, address: input.address, notes: input.notes, createdById: ctx.user.id },
    });
    return { customer, duplicates };
  });

  r.post('/api/customers/quick', 'customer.manage', async (ctx) => {
    const input = parse(quickCustomerSchema, ctx.body);
    const duplicates = await duplicatesByPhone(r, input.phone);
    const customer = await ctx.deps.db.customer.create({
      data: { name: input.name, phoneE164: input.phone, createdById: ctx.user.id },
    });
    return { customer, duplicates };
  });

  r.put('/api/customers/:id', 'customer.manage', async (ctx) => {
    const id = requireUuid(ctx.params.id);
    const input = parse(customerSchema, ctx.body);
    const before = await ctx.deps.db.customer.findUnique({ where: { id } });
    if (!before) throw notFound('Cliente não encontrado.');
    if (before.anonymizedAt) throw badRequest('Cliente anonimizado não pode ser editado.');
    const customer = await ctx.deps.db.customer.update({
      where: { id },
      data: { name: input.name, phoneE164: input.phone, cpf: input.cpf, email: input.email, address: input.address, notes: input.notes },
    });
    return { customer, duplicates: await duplicatesByPhone(r, input.phone, id) };
  });

  r.get('/api/customers/:id/export', 'customer.privacy', async (ctx) => {
    const id = requireUuid(ctx.params.id);
    const customer = await ctx.deps.db.customer.findUnique({
      where: { id },
      include: {
        sales: { include: { items: true, payments: true } },
        serviceOrders: { include: { items: true, events: true } },
      },
    });
    if (!customer) throw notFound('Cliente não encontrado.');
    await audit(ctx.deps.db, { userId: ctx.user.id, action: 'customer.exported', entity: 'Customer', entityId: id, ip: ctx.ip });
    ctx.reply.header('Content-Disposition', `attachment; filename="cliente-${id}.json"`);
    return { exportedAt: ctx.deps.clock.now(), customer };
  });

  r.post('/api/customers/:id/anonymize', 'customer.privacy', async (ctx) => {
    const id = requireUuid(ctx.params.id);
    const customer = await ctx.deps.db.customer.findUnique({ where: { id } });
    if (!customer) throw notFound('Cliente não encontrado.');
    if (customer.anonymizedAt) throw badRequest('Esse cliente já foi anonimizado.');
    await ctx.deps.db.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: { name: 'Cliente anonimizado', phoneE164: '', cpf: null, email: null, address: null, notes: null, anonymizedAt: ctx.deps.clock.now() },
      });
      await tx.serviceOrder.updateMany({ where: { customerId: id }, data: { unlockSecretEnc: null, serialImei: null } });
      await audit(tx, {
        userId: ctx.user.id,
        action: 'customer.anonymized',
        entity: 'Customer',
        entityId: id,
        before: { name: customer.name },
        ip: ctx.ip,
      });
    });
    return { ok: true };
  });
}
