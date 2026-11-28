import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  columnsOrderSchema,
  defaultsSettingsSchema,
  expenseCategorySchema,
  feeSettingsSchema,
  kanbanColumnSchema,
  printSettingsSchema,
  storeSettingsSchema,
  type AuditAction,
} from '@loja/shared';
import { z } from 'zod';
import { UPLOAD_DIR } from '../lib/paths.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { parse, requireUuid } from '../http/parse.ts';
import type { Router } from '../http/router.ts';
import { getStoreSettings, loadFeeConfig, maskFeeConfig } from '../services/settings.ts';

const discountLimitsSchema = z.object({
  limits: z.array(z.object({ roleId: z.uuid(), discountLimitBps: z.int().min(0).max(10000) })),
});

const IMAGE_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

export function settingsRoutes(r: Router) {
  r.get('/api/settings', 'auth', (ctx) => getStoreSettings(ctx.deps.db));

  const updateSettings = async (ctx: Parameters<Parameters<Router['put']>[2]>[0], data: Record<string, unknown>, action: AuditAction) => {
    const before = await getStoreSettings(ctx.deps.db);
    const updated = await ctx.deps.db.$transaction(async (tx) => {
      const result = await tx.storeSettings.update({ where: { id: before.id }, data });
      await audit(tx, { userId: ctx.user.id, action, entity: 'StoreSettings', entityId: before.id, before, after: result, ip: ctx.ip });
      return result;
    });
    return updated;
  };

  r.put('/api/settings/store', 'settings.manage', (ctx) => updateSettings(ctx, parse(storeSettingsSchema, ctx.body), 'settings.store_updated'));
  r.put('/api/settings/print', 'settings.manage', (ctx) => updateSettings(ctx, parse(printSettingsSchema, ctx.body), 'settings.print_updated'));
  r.put('/api/settings/defaults', 'settings.manage', (ctx) =>
    updateSettings(ctx, parse(defaultsSettingsSchema, ctx.body), 'settings.defaults_updated'),
  );

  r.put('/api/settings/discount-limits', 'settings.manage', async (ctx) => {
    const input = parse(discountLimitsSchema, ctx.body);
    await ctx.deps.db.$transaction(async (tx) => {
      for (const limit of input.limits) {
        const before = await tx.role.findUnique({ where: { id: limit.roleId } });
        if (!before) throw notFound('Perfil não encontrado.');
        if (before.discountLimitBps === limit.discountLimitBps) continue;
        await tx.role.update({ where: { id: limit.roleId }, data: { discountLimitBps: limit.discountLimitBps } });
        await audit(tx, {
          userId: ctx.user.id,
          action: 'role.discount_limit_changed',
          entity: 'Role',
          entityId: limit.roleId,
          before: { discountLimitBps: before.discountLimitBps },
          after: { discountLimitBps: limit.discountLimitBps },
          ip: ctx.ip,
        });
      }
    });
    return { ok: true };
  });

  r.get('/api/settings/discount-limits', 'settings.manage', (ctx) =>
    ctx.deps.db.role.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, discountLimitBps: true } }),
  );

  r.get('/api/settings/fees', 'auth', async (ctx) => {
    const config = await loadFeeConfig(ctx.deps.db);
    return ctx.can('finance.view') || ctx.can('settings.manage') ? config : maskFeeConfig(config);
  });

  r.put('/api/settings/fees', 'settings.manage', async (ctx) => {
    const input = parse(feeSettingsSchema, ctx.body);
    const before = await loadFeeConfig(ctx.deps.db);
    const settings = await getStoreSettings(ctx.deps.db);
    const seen = new Set<string>();
    for (const rule of input.rules) {
      if (rule.method !== 'credit' && rule.installments !== 1) throw badRequest('Só o crédito tem parcelas.');
      const key = `${rule.method}:${rule.installments}`;
      if (seen.has(key)) throw badRequest('Há regras de taxa repetidas.');
      seen.add(key);
    }
    await ctx.deps.db.$transaction(async (tx) => {
      await tx.feeRule.deleteMany({});
      await tx.feeRule.createMany({ data: input.rules });
      await tx.storeSettings.update({
        where: { id: settings.id },
        data: { maxInstallments: input.maxInstallments, minInstallmentCents: input.minInstallmentCents },
      });
      await audit(tx, { userId: ctx.user.id, action: 'settings.fees_updated', entity: 'FeeRule', before, after: input, ip: ctx.ip });
    });
    return loadFeeConfig(ctx.deps.db);
  });

  r.get('/api/expense-categories', 'auth', (ctx) =>
    ctx.deps.db.expenseCategory.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
  );

  r.post('/api/expense-categories', 'settings.manage', async (ctx) => {
    const input = parse(expenseCategorySchema, ctx.body);
    return ctx.deps.db.expenseCategory.create({ data: input });
  });

  r.put('/api/expense-categories/:id', 'settings.manage', async (ctx) => {
    const input = parse(expenseCategorySchema, ctx.body);
    return ctx.deps.db.expenseCategory.update({ where: { id: requireUuid(ctx.params.id) }, data: input });
  });

  r.get('/api/kanban/columns', 'auth', (ctx) =>
    ctx.deps.db.kanbanColumn.findMany({
      where: ctx.query.includeArchived === 'true' ? {} : { archived: false },
      orderBy: { order: 'asc' },
      include: { template: true },
    }),
  );

  r.post('/api/kanban/columns', 'settings.manage', async (ctx) => {
    const input = parse(kanbanColumnSchema, ctx.body);
    return ctx.deps.db.$transaction(async (tx) => {
      const last = await tx.kanbanColumn.aggregate({ _max: { order: true } });
      const template = input.templateBody?.trim()
        ? await tx.messageTemplate.create({ data: { name: input.name, body: input.templateBody } })
        : null;
      const column = await tx.kanbanColumn.create({
        data: {
          name: input.name,
          color: input.color,
          stageType: input.stageType,
          requiredFields: input.requiredFields,
          whatsappEnabled: input.whatsappEnabled,
          whatsappTrigger: input.whatsappTrigger,
          archived: input.archived,
          order: (last._max.order ?? -1) + 1,
          templateId: template?.id ?? null,
        },
        include: { template: true },
      });
      await audit(tx, { userId: ctx.user.id, action: 'kanban.column_created', entity: 'KanbanColumn', entityId: column.id, after: input, ip: ctx.ip });
      return column;
    });
  });

  r.put('/api/kanban/columns/:id', 'settings.manage', async (ctx) => {
    const id = requireUuid(ctx.params.id);
    const input = parse(kanbanColumnSchema, ctx.body);
    return ctx.deps.db.$transaction(async (tx) => {
      const before = await tx.kanbanColumn.findUnique({ where: { id }, include: { template: true } });
      if (!before) throw notFound('Coluna não encontrada.');
      if (input.archived && !before.archived) {
        const count = await tx.serviceOrder.count({ where: { columnId: id } });
        if (count > 0 && (before.stageType === 'entry' || before.stageType === 'in_progress' || before.stageType === 'ready')) {
          throw badRequest('Mova as OS desta coluna antes de arquivar.');
        }
      }
      if (before.stageType !== input.stageType || input.archived) {
        const sameType = await tx.kanbanColumn.count({ where: { stageType: before.stageType, archived: false, id: { not: id } } });
        if (sameType === 0 && ['entry', 'ready', 'done', 'cancelled'].includes(before.stageType)) {
          throw badRequest('O quadro precisa de pelo menos uma coluna ativa de cada etapa: entrada, pronto, finalizado e cancelado.');
        }
      }
      let templateId = before.templateId;
      const body = input.templateBody?.trim();
      if (body && before.templateId) {
        await tx.messageTemplate.update({ where: { id: before.templateId }, data: { body: input.templateBody!, name: input.name } });
      } else if (body) {
        templateId = (await tx.messageTemplate.create({ data: { name: input.name, body: input.templateBody! } })).id;
      }
      const column = await tx.kanbanColumn.update({
        where: { id },
        data: {
          name: input.name,
          color: input.color,
          stageType: input.stageType,
          requiredFields: input.requiredFields,
          whatsappEnabled: input.whatsappEnabled,
          whatsappTrigger: input.whatsappTrigger,
          archived: input.archived,
          templateId,
        },
        include: { template: true },
      });
      await audit(tx, { userId: ctx.user.id, action: 'kanban.column_updated', entity: 'KanbanColumn', entityId: id, before, after: input, ip: ctx.ip });
      return column;
    });
  });

  r.put('/api/kanban/columns-order', 'settings.manage', async (ctx) => {
    const input = parse(columnsOrderSchema, ctx.body);
    await ctx.deps.db.$transaction(async (tx) => {
      for (const [order, id] of input.ids.entries()) {
        await tx.kanbanColumn.update({ where: { id }, data: { order } });
      }
    });
    return { ok: true };
  });

  r.post('/api/uploads', ['settings.manage', 'product.manage'], async (ctx) => {
    const file = await ctx.req.file();
    if (!file) throw badRequest('Envie um arquivo.');
    const ext = IMAGE_TYPES[file.mimetype];
    if (!ext) throw badRequest('Envie uma imagem PNG, JPG ou WEBP.');
    const name = `${randomUUID()}${ext}`;
    await pipeline(file.file, createWriteStream(path.join(UPLOAD_DIR, name)));
    if (file.file.truncated) throw badRequest('A imagem pode ter no máximo 2 MB.');
    return { url: `/uploads/${name}` };
  });
}
