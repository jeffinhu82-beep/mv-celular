import { onlyDigits } from '@loja/shared';
import type { Prisma } from '../generated/prisma/client.ts';
import type { Router } from '../http/router.ts';

export function searchRoutes(r: Router) {
  r.get('/api/search', 'auth', async (ctx) => {
    const q = String(ctx.query.q ?? '').trim();
    if (q.length < 2) return { customers: [], serviceOrders: [], sales: [] };
    const digits = onlyDigits(q);
    const upper = q.toUpperCase();

    const customerWhere: Prisma.CustomerWhereInput = {
      anonymizedAt: null,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        ...(digits.length >= 3 ? [{ phoneE164: { contains: digits } }, { cpf: { contains: digits } }] : []),
      ],
    };

    const osScope: Prisma.ServiceOrderWhereInput = ctx.can('os.view_all') ? {} : { OR: [{ technicianId: ctx.user.id }, { technicianId: null }] };
    const osWhere: Prisma.ServiceOrderWhereInput = {
      AND: [
        osScope,
        {
          OR: [
            { number: { contains: upper } },
            { model: { contains: q, mode: 'insensitive' } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
            ...(digits.length >= 4 ? [{ serialImei: { contains: digits } }, { customer: { phoneE164: { contains: digits } } }] : []),
          ],
        },
      ],
    };

    const saleScope: Prisma.SaleWhereInput = ctx.can('sale.view_all') ? {} : { sellerId: ctx.user.id };
    const saleWhere: Prisma.SaleWhereInput = {
      AND: [
        saleScope,
        {
          OR: [
            { number: { contains: upper } },
            { quoteNumber: { contains: upper } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
          ],
        },
      ],
    };

    const [customers, serviceOrders, sales] = await Promise.all([
      ctx.deps.db.customer.findMany({ where: customerWhere, take: 6, orderBy: { name: 'asc' }, select: { id: true, name: true, phoneE164: true } }),
      ctx.deps.db.serviceOrder.findMany({
        where: osWhere,
        take: 6,
        orderBy: { createdAt: 'desc' },
        select: { id: true, number: true, brand: true, model: true, customer: { select: { name: true } }, column: { select: { name: true, color: true } } },
      }),
      ctx.deps.db.sale.findMany({
        where: saleWhere,
        take: 6,
        orderBy: { createdAt: 'desc' },
        select: { id: true, number: true, quoteNumber: true, status: true, totalCents: true, createdAt: true, customer: { select: { name: true } } },
      }),
    ]);
    return { customers, serviceOrders, sales };
  });
}
