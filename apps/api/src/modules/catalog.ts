import { categorySchema, marginBps, productSchema, stockAdjustSchema, stockEntrySchema } from '@loja/shared';
import type { Prisma } from '../generated/prisma/client.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { flag, pageParams, parse, requireUuid } from '../http/parse.ts';
import type { Router } from '../http/router.ts';
import { applyStockChange, reservedInOpenOrders } from '../services/stock.ts';

type ProductRow = Prisma.ProductGetPayload<{ include: { category: true } }>;

function presentProduct(product: ProductRow, reserved = 0) {
  return {
    ...product,
    marginBps: marginBps(product.priceCents, product.costCents),
    reservedQty: reserved,
    availableQty: product.stockQty - reserved,
    lowStock: product.type === 'product' && product.tracksStock && product.stockQty < product.minStock,
  };
}

function productWhere(query: Record<string, string | undefined>): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {};
  if (query.type === 'product' || query.type === 'service') where.type = query.type;
  if (query.active !== 'all') where.active = query.active === 'false' ? false : true;
  if (query.categoryId) where.categoryId = query.categoryId;
  if (flag(query.lowStock)) where.tracksStock = true;
  const term = query.q?.trim();
  if (term) {
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { sku: { equals: term, mode: 'insensitive' } },
      { barcode: term },
    ];
  }
  return where;
}

function nullIfEmpty(value: string | null | undefined) {
  return value ? value : null;
}

export function catalogRoutes(r: Router) {
  r.get('/api/categories', 'auth', (ctx) => ctx.deps.db.category.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { products: true } } } }));

  r.post('/api/categories', 'product.manage', async (ctx) => {
    const input = parse(categorySchema, ctx.body);
    return ctx.deps.db.category.create({ data: input });
  });

  r.put('/api/categories/:id', 'product.manage', async (ctx) => {
    const input = parse(categorySchema, ctx.body);
    return ctx.deps.db.category.update({ where: { id: requireUuid(ctx.params.id) }, data: input });
  });

  r.delete('/api/categories/:id', 'product.manage', async (ctx) => {
    const id = requireUuid(ctx.params.id);
    const count = await ctx.deps.db.product.count({ where: { categoryId: id } });
    if (count > 0) throw badRequest('Essa categoria tem produtos. Mova os produtos antes de excluir.');
    await ctx.deps.db.category.delete({ where: { id } });
    return { ok: true };
  });

  r.get('/api/products', 'auth', async (ctx) => {
    const { skip, take } = pageParams(ctx.query, 50);
    const where = productWhere(ctx.query);
    const lowStockOnly = flag(ctx.query.lowStock);
    const [rows, total] = await Promise.all([
      ctx.deps.db.product.findMany({
        where,
        include: { category: true },
        orderBy: { name: 'asc' },
        skip: lowStockOnly ? 0 : skip,
        take: lowStockOnly ? 500 : take,
      }),
      ctx.deps.db.product.count({ where }),
    ]);
    const reserved = await reservedInOpenOrders(ctx.deps.db, rows.map((row) => row.id));
    let items = rows.map((row) => presentProduct(row, reserved.get(row.id) ?? 0));
    if (!lowStockOnly) return { items, total };
    const low = items.filter((item) => item.lowStock);
    return { items: low.slice(skip, skip + take), total: low.length };
  });

  r.get('/api/products/lookup', 'auth', async (ctx) => {
    const code = ctx.query.code?.trim();
    if (!code) return { product: null };
    const product = await ctx.deps.db.product.findFirst({
      where: { active: true, OR: [{ barcode: code }, { sku: { equals: code, mode: 'insensitive' } }] },
      include: { category: true },
    });
    if (!product) return { product: null };
    const reserved = await reservedInOpenOrders(ctx.deps.db, [product.id]);
    return { product: presentProduct(product, reserved.get(product.id) ?? 0) };
  });

  r.get('/api/products/:id', 'auth', async (ctx) => {
    const id = requireUuid(ctx.params.id);
    const product = await ctx.deps.db.product.findUnique({ where: { id }, include: { category: true } });
    if (!product) throw notFound('Produto não encontrado.');
    const reserved = await reservedInOpenOrders(ctx.deps.db, [id]);
    return presentProduct(product, reserved.get(id) ?? 0);
  });

  r.post('/api/products', 'product.manage', async (ctx) => {
    const input = parse(productSchema, ctx.body);
    const isService = input.type === 'service';
    const product = await ctx.deps.db.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          type: input.type,
          name: input.name,
          sku: nullIfEmpty(input.sku),
          barcode: isService ? null : nullIfEmpty(input.barcode),
          categoryId: input.categoryId,
          costCents: isService ? 0 : input.costCents,
          priceCents: input.priceCents,
          minStock: isService ? 0 : input.minStock,
          tracksStock: isService ? false : input.tracksStock,
          active: input.active,
          estimatedMinutes: isService ? (input.estimatedMinutes ?? null) : null,
          photoUrl: input.photoUrl,
          createdById: ctx.user.id,
        },
      });
      if (!isService && input.tracksStock && input.initialStock && input.initialStock > 0) {
        await applyStockChange(tx, {
          productId: created.id,
          qty: input.initialStock,
          type: 'adjust',
          reason: 'Estoque inicial',
          userId: ctx.user.id,
        });
        await tx.product.update({ where: { id: created.id }, data: { costCents: input.costCents } });
      }
      await audit(tx, { userId: ctx.user.id, action: 'product.created', entity: 'Product', entityId: created.id, after: input, ip: ctx.ip });
      return tx.product.findUniqueOrThrow({ where: { id: created.id }, include: { category: true } });
    });
    return presentProduct(product);
  });

  r.put('/api/products/:id', 'product.manage', async (ctx) => {
    const id = requireUuid(ctx.params.id);
    const input = parse(productSchema, ctx.body);
    const before = await ctx.deps.db.product.findUnique({ where: { id } });
    if (!before) throw notFound('Produto não encontrado.');
    if (before.type !== input.type) throw badRequest('Não é possível trocar o tipo de um item já cadastrado.');
    const isService = input.type === 'service';
    const product = await ctx.deps.db.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: {
          name: input.name,
          sku: nullIfEmpty(input.sku),
          barcode: isService ? null : nullIfEmpty(input.barcode),
          categoryId: input.categoryId,
          costCents: isService ? 0 : ctx.can('product.cost.view') ? input.costCents : before.costCents,
          priceCents: input.priceCents,
          minStock: isService ? 0 : input.minStock,
          tracksStock: isService ? false : input.tracksStock,
          active: input.active,
          estimatedMinutes: isService ? (input.estimatedMinutes ?? null) : null,
          photoUrl: input.photoUrl,
        },
        include: { category: true },
      });
      const priceChanged = before.priceCents !== updated.priceCents || before.costCents !== updated.costCents;
      await audit(tx, {
        userId: ctx.user.id,
        action: priceChanged ? 'product.price_changed' : 'product.updated',
        entity: 'Product',
        entityId: id,
        before: { name: before.name, priceCents: before.priceCents, costCents: before.costCents, active: before.active },
        after: { name: updated.name, priceCents: updated.priceCents, costCents: updated.costCents, active: updated.active },
        ip: ctx.ip,
      });
      return updated;
    });
    return presentProduct(product);
  });

  r.post('/api/stock/entries', 'stock.manage', async (ctx) => {
    const input = parse(stockEntrySchema, ctx.body);
    return ctx.deps.db.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: input.productId } });
      if (!product) throw notFound('Produto não encontrado.');
      if (product.type !== 'product' || !product.tracksStock) throw badRequest('Esse item não controla estoque.');
      const movement = await applyStockChange(tx, {
        productId: input.productId,
        qty: input.qty,
        type: 'purchase',
        unitCostCents: input.unitCostCents,
        supplier: input.supplier,
        reason: input.notes,
        userId: ctx.user.id,
      });
      const updated = await tx.product.findUniqueOrThrow({ where: { id: input.productId } });
      await audit(tx, {
        userId: ctx.user.id,
        action: 'stock.purchase',
        entity: 'Product',
        entityId: input.productId,
        before: { stockQty: product.stockQty, costCents: product.costCents },
        after: { stockQty: updated.stockQty, costCents: updated.costCents, qty: input.qty, unitCostCents: input.unitCostCents },
        ip: ctx.ip,
      });
      return { movement, product: updated };
    });
  });

  r.post('/api/stock/adjustments', 'stock.manage', async (ctx) => {
    const input = parse(stockAdjustSchema, ctx.body);
    return ctx.deps.db.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: input.productId } });
      if (!product) throw notFound('Produto não encontrado.');
      if (product.type !== 'product' || !product.tracksStock) throw badRequest('Esse item não controla estoque.');
      const movement = await applyStockChange(tx, {
        productId: input.productId,
        qty: input.qtyDelta,
        type: 'adjust',
        reason: input.reason,
        userId: ctx.user.id,
      });
      await audit(tx, {
        userId: ctx.user.id,
        action: 'stock.adjusted',
        entity: 'Product',
        entityId: input.productId,
        before: { stockQty: product.stockQty },
        after: { stockQty: product.stockQty + input.qtyDelta, reason: input.reason },
        ip: ctx.ip,
      });
      return { movement };
    });
  });

  r.get('/api/stock/movements', ['stock.manage', 'product.manage'], async (ctx) => {
    const { skip, take } = pageParams(ctx.query, 50);
    const where: Prisma.StockMovementWhereInput = {};
    if (ctx.query.productId) where.productId = requireUuid(ctx.query.productId);
    if (ctx.query.type) where.type = ctx.query.type as Prisma.StockMovementWhereInput['type'];
    const [rows, total] = await Promise.all([
      ctx.deps.db.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { product: { select: { id: true, name: true } } },
      }),
      ctx.deps.db.stockMovement.count({ where }),
    ]);
    const userIds = [...new Set(rows.map((row) => row.userId).filter((id): id is string => Boolean(id)))];
    const users = await ctx.deps.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const names = new Map(users.map((user) => [user.id, user.name]));
    return { items: rows.map((row) => ({ ...row, userName: row.userId ? (names.get(row.userId) ?? null) : null })), total };
  });

  r.post('/api/products/import', 'product.manage', async (ctx) => {
    const body = ctx.body as { rows?: unknown };
    if (!Array.isArray(body?.rows) || body.rows.length === 0) throw badRequest('Envie as linhas do CSV.');
    if (body.rows.length > 2000) throw badRequest('Importe no máximo 2.000 linhas por vez.');
    const parsed = body.rows.map((row, index) => {
      const result = productSchema.safeParse(row);
      if (!result.success) throw badRequest(`Linha ${index + 2}: ${result.error.issues[0]?.message ?? 'inválida'}`);
      return result.data;
    });
    const skus = parsed.map((row) => row.sku).filter((sku): sku is string => Boolean(sku));
    if (new Set(skus).size !== skus.length) throw conflict('Há SKUs repetidos no arquivo.');
    const created = await ctx.deps.db.$transaction(async (tx) => {
      let count = 0;
      for (const input of parsed) {
        const isService = input.type === 'service';
        const product = await tx.product.create({
          data: {
            type: input.type,
            name: input.name,
            sku: nullIfEmpty(input.sku),
            barcode: isService ? null : nullIfEmpty(input.barcode),
            costCents: isService ? 0 : input.costCents,
            priceCents: input.priceCents,
            minStock: isService ? 0 : input.minStock,
            tracksStock: !isService && input.tracksStock,
            createdById: ctx.user.id,
          },
        });
        if (!isService && input.tracksStock && input.initialStock) {
          await applyStockChange(tx, { productId: product.id, qty: input.initialStock, type: 'adjust', reason: 'Importação CSV', userId: ctx.user.id });
        }
        count += 1;
      }
      await audit(tx, { userId: ctx.user.id, action: 'product.imported', entity: 'Product', after: { count }, ip: ctx.ip });
      return count;
    }, { timeout: 60000 });
    return { created };
  });
}
