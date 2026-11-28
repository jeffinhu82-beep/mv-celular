import {
  addDays,
  CLOSED_WINDOW_DAYS,
  computeCart,
  formatBps,
  formatMoney,
  isLate,
  LATE_STAGE_TYPES,
  missingRequiredFields,
  OPEN_STAGE_TYPES,
  OS_ACCESS,
  requiredFieldsMessage,
  serviceOrderApprovalSchema,
  serviceOrderCheckoutSchema,
  serviceOrderCreateSchema,
  serviceOrderDepositSchema,
  serviceOrderMoveSchema,
  serviceOrderPrintSchema,
  serviceOrderQuoteSchema,
  serviceOrderUpdateSchema,
  whatsappLogSchema,
  type StageType,
} from '@loja/shared';
import type { Prisma } from '../generated/prisma/client.ts';
import type { Db, Tx } from '../db.ts';
import { failpoint } from '../deps.ts';
import { audit } from '../lib/audit.ts';
import { nextNumber } from '../lib/counter.ts';
import { decryptSecret, encryptSecret } from '../lib/crypto.ts';
import { conflict, fieldError, notFound, unprocessable } from '../lib/errors.ts';
import { flag, parse, requireUuid } from '../http/parse.ts';
import type { Ctx, Router } from '../http/router.ts';
import { recordPayments, requireOpenSession } from '../services/cash.ts';
import { serviceOrderTotal } from '../services/receivables.ts';
import { checkoutOrThrow, lockProducts, userNames } from '../services/sales.ts';
import {
  activeDeposits,
  addEvent,
  assertEditable,
  deliverServiceOrder,
  isClosedStage,
  lockServiceOrder,
  moveServiceOrder,
  nextPosition,
  reverseDeposits,
  serviceOrderScope,
  stageColumn,
  type LockedServiceOrder,
} from '../services/service-orders.ts';
import { getStoreSettings, loadFeeConfig } from '../services/settings.ts';
import { reservedInOpenOrders } from '../services/stock.ts';
import { periodFromQuery } from '../services/summary.ts';

const DAY_MS = 86400000;
const OPEN_STAGES = [...OPEN_STAGE_TYPES] as StageType[];

interface MoneyState {
  approvalStatus: string | null;
  diagnosisFeeCents: number;
  discountCents: number;
  items: { qty: number; unitPriceCents: number }[];
  payments: { coveredCents: number; reversedAt: Date | null }[];
  sale: { totalCents: number; paidCents: number; status: string } | null;
}

function moneyOf(os: MoneyState, open: boolean) {
  if (os.sale) {
    const pending = os.sale.status === 'pending';
    return {
      totalCents: os.sale.totalCents,
      paidCents: os.sale.status === 'cancelled' ? 0 : os.sale.paidCents,
      balanceCents: pending ? os.sale.totalCents - os.sale.paidCents : 0,
    };
  }
  const totalCents = serviceOrderTotal(os);
  const paidCents = os.payments.filter((payment) => !payment.reversedAt).reduce((sum, payment) => sum + payment.coveredCents, 0);
  return { totalCents, paidCents, balanceCents: open ? Math.max(0, totalCents - paidCents) : 0 };
}

interface FlagState {
  column: { stageType: StageType };
  dueAt: Date | null;
  columnEnteredAt: Date;
  parentOsId: string | null;
}

function flagsOf(os: FlagState, open: boolean, now: Date, staleOsDays: number, waitingPart: boolean) {
  return {
    late: open && isLate(os.column.stageType, os.dueAt, now),
    stale: open && os.columnEnteredAt.getTime() < now.getTime() - staleOsDays * DAY_MS,
    warranty: Boolean(os.parentOsId),
    waitingPart: open && waitingPart,
  };
}

interface PartLine {
  kind: string;
  qty: number;
  productId: string | null;
  product: { stockQty: number; tracksStock: boolean; type: string } | null;
}

async function waitingParts(db: Db, orders: { id: string; open: boolean; items: PartLine[] }[]) {
  const tracked = (item: PartLine) => item.kind === 'part' && item.productId && item.product?.tracksStock && item.product.type === 'product';
  const ids = [...new Set(orders.filter((os) => os.open).flatMap((os) => os.items.filter(tracked).map((item) => item.productId!)))];
  const reserved = await reservedInOpenOrders(db, ids);
  const waiting = new Set<string>();
  for (const os of orders) {
    if (!os.open) continue;
    if (os.items.some((item) => tracked(item) && (reserved.get(item.productId!) ?? 0) > item.product!.stockQty)) waiting.add(os.id);
  }
  return waiting;
}

async function staffList(db: Db) {
  return db.user.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
}

function boardFilters(ctx: Ctx, now: Date, staleOsDays: number): Prisma.ServiceOrderWhereInput[] {
  const filters: Prisma.ServiceOrderWhereInput[] = [serviceOrderScope(ctx)];
  const technician = ctx.query.technicianId;
  if (technician === 'none') filters.push({ technicianId: null });
  else if (technician) filters.push({ technicianId: requireUuid(technician, 'Técnico') });
  const term = ctx.query.q?.trim();
  if (term) {
    const digits = term.replace(/\D/g, '');
    filters.push({
      OR: [
        { number: { contains: term, mode: 'insensitive' } },
        { brand: { contains: term, mode: 'insensitive' } },
        { model: { contains: term, mode: 'insensitive' } },
        { serialImei: { contains: term, mode: 'insensitive' } },
        { customer: { name: { contains: term, mode: 'insensitive' } } },
        ...(digits.length >= 4 ? [{ customer: { phoneE164: { contains: digits } } }] : []),
      ],
    });
  }
  const open = { column: { stageType: { in: OPEN_STAGES } } };
  if (flag(ctx.query.late)) filters.push({ column: { stageType: { in: LATE_STAGE_TYPES } }, dueAt: { lt: now } });
  if (flag(ctx.query.stale)) filters.push({ ...open, columnEnteredAt: { lt: new Date(now.getTime() - staleOsDays * DAY_MS) } });
  if (ctx.query.period) {
    const { range } = periodFromQuery(ctx.query, now);
    filters.push({ createdAt: { gte: range.start, lt: range.end } });
  }
  if (!flag(ctx.query.all)) filters.push({ OR: [open, { closedAt: { gte: addDays(now, -CLOSED_WINDOW_DAYS) } }] });
  return filters;
}

async function board(ctx: Ctx) {
  const db = ctx.deps.db;
  const now = ctx.deps.clock.now();
  const settings = await getStoreSettings(db);
  const where = { AND: boardFilters(ctx, now, settings.staleOsDays) };
  const [columns, orders, staff] = await Promise.all([
    db.kanbanColumn.findMany({ where: { archived: false }, orderBy: { order: 'asc' }, include: { template: { select: { id: true, name: true, body: true } } } }),
    db.serviceOrder.findMany({
      where,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        number: true,
        columnId: true,
        position: true,
        deviceType: true,
        brand: true,
        model: true,
        reportedIssue: true,
        technicianId: true,
        dueAt: true,
        columnEnteredAt: true,
        closedAt: true,
        createdAt: true,
        parentOsId: true,
        approvalStatus: true,
        diagnosisFeeCents: true,
        discountCents: true,
        warrantyDays: true,
        warrantyUntil: true,
        column: { select: { stageType: true } },
        customer: { select: { id: true, name: true, phoneE164: true } },
        items: { select: { kind: true, qty: true, unitPriceCents: true, productId: true, product: { select: { stockQty: true, tracksStock: true, type: true } } } },
        payments: { select: { coveredCents: true, reversedAt: true } },
        sale: { select: { id: true, number: true, status: true, totalCents: true, paidCents: true } },
      },
    }),
    staffList(db),
  ]);
  const names = new Map(staff.map((user) => [user.id, user.name]));
  const openOf = (os: (typeof orders)[number]) => !os.sale && !isClosedStage(os.column.stageType);
  const waiting = await waitingParts(db, orders.map((os) => ({ id: os.id, open: openOf(os), items: os.items })));
  const cards = orders.map((os) => {
    const open = openOf(os);
    return {
      id: os.id,
      number: os.number,
      columnId: os.columnId,
      position: os.position,
      deviceType: os.deviceType,
      brand: os.brand,
      model: os.model,
      reportedIssue: os.reportedIssue,
      customer: os.customer,
      technicianId: os.technicianId,
      technicianName: os.technicianId ? (names.get(os.technicianId) ?? null) : null,
      dueAt: os.dueAt,
      columnEnteredAt: os.columnEnteredAt,
      closedAt: os.closedAt,
      createdAt: os.createdAt,
      approvalStatus: os.approvalStatus,
      warrantyDays: os.warrantyDays,
      warrantyUntil: os.warrantyUntil,
      sale: os.sale ? { id: os.sale.id, number: os.sale.number, status: os.sale.status } : null,
      ...moneyOf(os, open),
      flags: flagsOf(os, open, now, settings.staleOsDays, waiting.has(os.id)),
    };
  });
  const closedOrder = (a: (typeof cards)[number], b: (typeof cards)[number]) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0);
  const showSums = ctx.can('finance.view');
  const limited = !flag(ctx.query.all);
  return {
    now,
    staleOsDays: settings.staleOsDays,
    closedWindowDays: CLOSED_WINDOW_DAYS,
    staff,
    columns: columns.map((column) => {
      const closed = isClosedStage(column.stageType);
      const inColumn = cards.filter((card) => card.columnId === column.id);
      if (closed) inColumn.sort(closedOrder);
      return {
        id: column.id,
        name: column.name,
        color: column.color,
        order: column.order,
        stageType: column.stageType,
        requiredFields: column.requiredFields,
        whatsappEnabled: column.whatsappEnabled,
        whatsappTrigger: column.whatsappTrigger,
        template: column.template,
        limited: closed && limited,
        count: inColumn.length,
        sumCents: showSums ? inColumn.reduce((sum, card) => sum + card.totalCents, 0) : null,
        cards: inColumn,
      };
    }),
  };
}

async function getDetail(ctx: Ctx, id: string) {
  const db = ctx.deps.db;
  const os = await db.serviceOrder.findFirst({
    where: { AND: [{ id }, serviceOrderScope(ctx)] },
    include: {
      customer: { select: { id: true, name: true, phoneE164: true, cpf: true, anonymizedAt: true } },
      column: { include: { template: { select: { id: true, name: true, body: true } } } },
      items: {
        orderBy: { position: 'asc' },
        include: { product: { select: { id: true, name: true, sku: true, stockQty: true, tracksStock: true, type: true, active: true } } },
      },
      payments: { orderBy: { receivedAt: 'asc' } },
      sale: { select: { id: true, number: true, status: true, totalCents: true, paidCents: true, completedAt: true } },
      events: { orderBy: { createdAt: 'asc' } },
      parentOs: { select: { id: true, number: true, deliveredAt: true, warrantyUntil: true } },
      returns: { orderBy: { createdAt: 'asc' }, select: { id: true, number: true, createdAt: true } },
    },
  });
  if (!os) throw notFound('OS não encontrada.');
  const settings = await getStoreSettings(db);
  const now = ctx.deps.clock.now();
  const open = !os.sale && !isClosedStage(os.column.stageType);
  const partIds = [...new Set(os.items.filter((item) => item.kind === 'part' && item.productId).map((item) => item.productId!))];
  const [reservedElsewhere, columns, names] = await Promise.all([
    reservedInOpenOrders(db, partIds, os.id),
    db.kanbanColumn.findMany({ select: { id: true, name: true, color: true } }),
    userNames(db, [
      os.technicianId,
      os.createdById,
      os.approvalRegisteredById,
      ...os.payments.map((payment) => payment.receivedById),
      ...os.events.map((event) => event.userId),
    ]),
  ]);
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const neededByProduct = new Map<string, number>();
  for (const item of os.items) {
    if (item.kind === 'part' && item.productId) neededByProduct.set(item.productId, (neededByProduct.get(item.productId) ?? 0) + item.qty);
  }
  const items = os.items.map((item) => {
    const tracked = Boolean(item.product && item.product.tracksStock && item.product.type === 'product');
    const available = tracked ? item.product!.stockQty - (reservedElsewhere.get(item.productId!) ?? 0) : null;
    const shortage = open && item.kind === 'part' && available !== null && (neededByProduct.get(item.productId!) ?? 0) > available;
    return {
      id: item.id,
      productId: item.productId,
      product: item.product ? { id: item.product.id, name: item.product.name, sku: item.product.sku, active: item.product.active } : null,
      kind: item.kind,
      name: item.name,
      qty: item.qty,
      unitPriceCents: item.unitPriceCents,
      unitCostCents: item.unitCostCents,
      totalCents: item.qty * item.unitPriceCents,
      tracksStock: tracked,
      availableQty: available === null ? null : Math.max(0, available),
      shortage,
    };
  });
  const money = moneyOf(os, open);
  const depositCents = os.payments.filter((payment) => !payment.reversedAt && !payment.saleId).reduce((sum, payment) => sum + payment.coveredCents, 0);
  const grossCents = os.items.reduce((sum, item) => sum + item.qty * item.unitPriceCents, 0);
  const { unlockSecretEnc, ...rest } = os;
  return {
    ...rest,
    hasSecret: Boolean(unlockSecretEnc),
    open,
    items,
    technicianName: os.technicianId ? (names.get(os.technicianId) ?? null) : null,
    createdByName: names.get(os.createdById) ?? null,
    approvalRegisteredByName: os.approvalRegisteredById ? (names.get(os.approvalRegisteredById) ?? null) : null,
    payments: os.payments.map((payment) => ({ ...payment, receivedByName: names.get(payment.receivedById) ?? null, deposit: !payment.saleId })),
    events: os.events.map((event) => ({
      ...event,
      userName: event.userId ? (names.get(event.userId) ?? null) : null,
      fromColumn: event.fromColumnId ? (columnById.get(event.fromColumnId) ?? null) : null,
      toColumn: event.toColumnId ? (columnById.get(event.toColumnId) ?? null) : null,
    })),
    grossCents,
    depositCents,
    ...money,
    warrantyActive: Boolean(os.warrantyUntil && os.warrantyUntil > now),
    flags: flagsOf(os, open, now, settings.staleOsDays, items.some((item) => item.shortage)),
  };
}

async function assertCustomer(db: Db | Tx, customerId: string) {
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { anonymizedAt: true } });
  if (!customer || customer.anonymizedAt) throw fieldError('customerId', 'Cliente não encontrado.');
}

async function assertTechnician(db: Db | Tx, technicianId: string | null | undefined) {
  if (!technicianId) return;
  const user = await db.user.findUnique({ where: { id: technicianId }, select: { active: true } });
  if (!user || !user.active) throw fieldError('technicianId', 'Técnico não encontrado.');
}

function parseDue(value: string | null | undefined) {
  if (value === undefined) return undefined;
  return value ? new Date(value) : null;
}

async function createServiceOrder(ctx: Ctx) {
  const input = parse(serviceOrderCreateSchema, ctx.body);
  const now = ctx.deps.clock.now();
  const db = ctx.deps.db;
  await assertCustomer(db, input.customerId);
  await assertTechnician(db, input.technicianId);
  if (input.parentOsId) {
    const parent = await db.serviceOrder.findUnique({ where: { id: input.parentOsId }, select: { id: true } });
    if (!parent) throw fieldError('parentOsId', 'OS original não encontrada.');
  }
  const id = await db.$transaction(async (tx) => {
    const settings = await getStoreSettings(tx);
    const column = await stageColumn(tx, 'entry');
    const number = await nextNumber(tx, 'os');
    const hasSecret = input.unlockType !== 'none' && Boolean(input.unlockSecret);
    const os = await tx.serviceOrder.create({
      data: {
        number,
        customerId: input.customerId,
        deviceType: input.deviceType,
        brand: input.brand,
        model: input.model,
        color: input.color,
        serialImei: input.serialImei,
        unlockType: input.unlockType,
        unlockSecretEnc: hasSecret ? encryptSecret(input.unlockSecret!, ctx.deps.config.secretEncryptionKey) : null,
        accessories: input.accessories,
        checklist: input.checklist as Prisma.InputJsonValue,
        reportedIssue: input.reportedIssue,
        dueAt: parseDue(input.dueAt) ?? null,
        technicianId: input.technicianId,
        parentOsId: input.parentOsId,
        warrantyDays: input.warrantyDays ?? settings.warrantyDays,
        columnId: column.id,
        columnEnteredAt: now,
        position: await nextPosition(tx, column.id),
        createdById: ctx.user.id,
        createdAt: now,
      },
    });
    await addEvent(tx, os.id, { type: 'created', userId: ctx.user.id, now, toColumnId: column.id });
    await audit(tx, {
      userId: ctx.user.id,
      action: 'os.created',
      entity: 'ServiceOrder',
      entityId: os.id,
      after: { number, customerId: os.customerId, device: `${os.brand} ${os.model}`, column: column.name, parentOsId: os.parentOsId },
      ip: ctx.ip,
    });
    return os.id;
  });
  return getDetail(ctx, id);
}

const EDITABLE_FIELDS = [
  'customerId',
  'deviceType',
  'brand',
  'model',
  'color',
  'serialImei',
  'unlockType',
  'accessories',
  'checklist',
  'reportedIssue',
  'diagnosis',
  'dueAt',
  'technicianId',
  'warrantyDays',
] as const;

function comparable(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value ?? null);
}

async function updateServiceOrder(ctx: Ctx) {
  const id = requireUuid(ctx.params.id);
  const input = parse(serviceOrderUpdateSchema, ctx.body);
  const now = ctx.deps.clock.now();
  await ctx.deps.db.$transaction(async (tx) => {
    const os = await lockServiceOrder(tx, id, serviceOrderScope(ctx));
    assertEditable(os);
    if (input.customerId && input.customerId !== os.customerId) await assertCustomer(tx, input.customerId);
    if (input.technicianId && input.technicianId !== os.technicianId) await assertTechnician(tx, input.technicianId);
    const next: Record<string, unknown> = {};
    for (const key of EDITABLE_FIELDS) {
      const value = key === 'dueAt' ? parseDue(input.dueAt) : input[key];
      if (value === undefined) continue;
      if (comparable(value) !== comparable(os[key])) next[key] = value;
    }
    const unlockType = (input.unlockType ?? os.unlockType) as string;
    let secretChanged = false;
    if (unlockType === 'none' && os.unlockSecretEnc) {
      next.unlockSecretEnc = null;
      secretChanged = true;
    } else if (unlockType !== 'none' && input.unlockSecret) {
      next.unlockSecretEnc = encryptSecret(input.unlockSecret, ctx.deps.config.secretEncryptionKey);
      secretChanged = true;
    }
    const fields = Object.keys(next).filter((key) => key !== 'unlockSecretEnc');
    if (secretChanged) fields.push('unlockSecret');
    if (fields.length === 0) return;
    await tx.serviceOrder.update({ where: { id }, data: next as Prisma.ServiceOrderUncheckedUpdateInput });
    await addEvent(tx, id, { type: 'edited', userId: ctx.user.id, now, data: { fields } });
    const visible = fields.filter((key) => key !== 'unlockSecret');
    await audit(tx, {
      userId: ctx.user.id,
      action: 'os.updated',
      entity: 'ServiceOrder',
      entityId: id,
      before: Object.fromEntries(visible.map((key) => [key, os[key as keyof typeof os]])),
      after: { ...Object.fromEntries(visible.map((key) => [key, next[key]])), ...(secretChanged ? { unlockSecret: 'alterada' } : {}) },
      ip: ctx.ip,
    });
  });
  return getDetail(ctx, id);
}

function effectiveBps(grossCents: number, discountCents: number) {
  if (grossCents <= 0 || discountCents <= 0) return 0;
  return Math.ceil((discountCents * 10000) / grossCents);
}

async function saveQuote(ctx: Ctx) {
  const id = requireUuid(ctx.params.id);
  const input = parse(serviceOrderQuoteSchema, ctx.body);
  const now = ctx.deps.clock.now();
  await ctx.deps.db.$transaction(async (tx) => {
    const os = await lockServiceOrder(tx, id, serviceOrderScope(ctx));
    assertEditable(os);
    const products = await lockProducts(tx, input.items.map((item) => item.productId));
    for (const item of input.items) {
      if (item.productId && !products.has(item.productId)) throw notFound('Produto não encontrado.');
    }
    const lines = input.items.map((item, position) => {
      const product = item.productId ? products.get(item.productId) : undefined;
      return {
        productId: product?.id ?? null,
        kind: item.kind,
        name: item.name,
        qty: item.qty,
        unitPriceCents: item.unitPriceCents,
        unitCostCents: product?.costCents ?? 0,
        position,
      };
    });
    const cart = computeCart(
      lines.map((line) => ({ qty: line.qty, unitPriceCents: line.unitPriceCents, unitCostCents: line.unitCostCents })),
      { mode: 'amount', value: input.discountCents },
    );
    const beforeGross = os.items.reduce((sum, item) => sum + item.qty * item.unitPriceCents, 0);
    const beforeBps = effectiveBps(beforeGross, Math.min(os.discountCents, beforeGross));
    const overLimit = cart.discountCents > 0 && cart.effectiveDiscountBps > ctx.user.discountLimitBps && cart.effectiveDiscountBps > beforeBps;
    let approvedById: string | null = null;
    if (overLimit) {
      const approver = await ctx.approve(
        'sale.discount_over_limit',
        `Desconto de ${formatBps(cart.effectiveDiscountBps)} passa do seu limite de ${formatBps(ctx.user.discountLimitBps)}. Peça a autorização de quem tem permissão.`,
      );
      approvedById = approver?.id ?? null;
    }
    const depositCents = activeDeposits(os).reduce((sum, payment) => sum + payment.coveredCents, 0);
    const nextTotal = serviceOrderTotal({ ...os, discountCents: cart.discountCents, items: lines });
    if (nextTotal < depositCents) {
      throw conflict(`O total não pode ficar abaixo do sinal já recebido (${formatMoney(depositCents)}).`);
    }
    await tx.serviceOrderItem.deleteMany({ where: { serviceOrderId: id } });
    if (lines.length > 0) await tx.serviceOrderItem.createMany({ data: lines.map((line) => ({ ...line, serviceOrderId: id })) });
    await tx.serviceOrder.update({ where: { id }, data: { discountCents: cart.discountCents } });
    const summary = { itemsCount: lines.length, grossCents: cart.grossCents, discountCents: cart.discountCents, totalCents: cart.totalCents };
    await addEvent(tx, id, { type: 'quote_updated', userId: ctx.user.id, now, data: summary });
    await audit(tx, {
      userId: ctx.user.id,
      approvedById,
      action: 'os.quote_updated',
      entity: 'ServiceOrder',
      entityId: id,
      before: { itemsCount: os.items.length, grossCents: beforeGross, discountCents: os.discountCents },
      after: { ...summary, items: lines.map((line) => ({ name: line.name, kind: line.kind, qty: line.qty, unitPriceCents: line.unitPriceCents })) },
      ip: ctx.ip,
    });
    if (overLimit) {
      await audit(tx, {
        userId: ctx.user.id,
        approvedById,
        action: 'os.discount_over_limit',
        entity: 'ServiceOrder',
        entityId: id,
        after: { number: os.number, discountCents: cart.discountCents, effectiveDiscountBps: cart.effectiveDiscountBps },
        ip: ctx.ip,
      });
    }
  });
  return getDetail(ctx, id);
}

async function cancelWithDeposits(ctx: Ctx, tx: Tx, os: LockedServiceOrder, now: Date) {
  const deposits = activeDeposits(os);
  if (deposits.length === 0) return { approvedById: null, reversedCents: 0 };
  const approver = await ctx.approve('sale.cancel', 'Cancelar uma OS com sinal recebido precisa de autorização. O sinal será estornado.');
  const session = await requireOpenSession(tx);
  const reversed = await reverseDeposits(tx, os, { session, userId: ctx.user.id, approvedById: approver?.id ?? null, now });
  return { approvedById: approver?.id ?? null, reversedCents: reversed.amountCents };
}

async function auditCancelled(ctx: Ctx, tx: Tx, os: LockedServiceOrder, target: { name: string }, result: { approvedById: string | null; reversedCents: number }) {
  await audit(tx, {
    userId: ctx.user.id,
    approvedById: result.approvedById,
    action: 'os.cancelled',
    entity: 'ServiceOrder',
    entityId: os.id,
    before: { column: os.column.name },
    after: { column: target.name, reversedCents: result.reversedCents },
    ip: ctx.ip,
  });
}

async function registerApproval(ctx: Ctx) {
  const id = requireUuid(ctx.params.id);
  const input = parse(serviceOrderApprovalSchema, ctx.body);
  const now = ctx.deps.clock.now();
  await ctx.deps.db.$transaction(async (tx) => {
    const os = await lockServiceOrder(tx, id, serviceOrderScope(ctx));
    assertEditable(os);
    const approved = input.decision === 'approved';
    if (approved && os.items.length === 0) throw unprocessable('Lance o orçamento antes de registrar a aprovação.', 'QUOTE_EMPTY');
    const feeCents = approved ? 0 : input.diagnosisFeeCents;
    const depositCents = activeDeposits(os).reduce((sum, payment) => sum + payment.coveredCents, 0);
    if (!approved && feeCents > 0 && depositCents > feeCents) {
      throw conflict(`O sinal recebido (${formatMoney(depositCents)}) é maior que a taxa de diagnóstico. Ajuste a taxa ou recuse sem taxa para estornar o sinal.`);
    }
    await tx.serviceOrder.update({
      where: { id },
      data: {
        approvalStatus: input.decision,
        approvalBy: input.by,
        approvalChannel: input.channel,
        approvalAt: now,
        approvalRegisteredById: ctx.user.id,
        diagnosisFeeCents: feeCents,
      },
    });
    await addEvent(tx, id, {
      type: approved ? 'approved' : 'rejected',
      userId: ctx.user.id,
      now,
      data: { by: input.by, channel: input.channel, diagnosisFeeCents: feeCents },
    });
    await audit(tx, {
      userId: ctx.user.id,
      action: approved ? 'os.approved' : 'os.rejected',
      entity: 'ServiceOrder',
      entityId: id,
      before: { approvalStatus: os.approvalStatus },
      after: { approvalStatus: input.decision, by: input.by, channel: input.channel, diagnosisFeeCents: feeCents },
      ip: ctx.ip,
    });
    if (approved) return;
    if (feeCents > 0) {
      const ready = await stageColumn(tx, 'ready');
      await moveServiceOrder(tx, os, ready, { userId: ctx.user.id, now, data: { reason: 'Orçamento recusado com taxa de diagnóstico' } });
      return;
    }
    const target = await stageColumn(tx, 'cancelled', 'first');
    const result = await cancelWithDeposits(ctx, tx, os, now);
    await moveServiceOrder(tx, os, target, { userId: ctx.user.id, now, data: { reason: 'Orçamento recusado' } });
    await auditCancelled(ctx, tx, os, target, result);
  });
  return getDetail(ctx, id);
}

async function moveOrder(ctx: Ctx) {
  const id = requireUuid(ctx.params.id);
  const input = parse(serviceOrderMoveSchema, ctx.body);
  const now = ctx.deps.clock.now();
  const outcome = await ctx.deps.db.$transaction(async (tx) => {
    const target = await tx.kanbanColumn.findUnique({ where: { id: input.columnId } });
    if (!target || target.archived) throw notFound('Coluna não encontrada.');
    const os = await lockServiceOrder(tx, id, serviceOrderScope(ctx));
    assertEditable(os);
    if (target.stageType === 'done') throw conflict('Use "Receber e entregar" para finalizar a OS.');
    const changing = target.id !== os.columnId;
    if (changing) {
      const missing = missingRequiredFields(
        { itemsCount: os.items.length, diagnosis: os.diagnosis, technicianId: os.technicianId, approvalStatus: os.approvalStatus, dueAt: os.dueAt },
        Array.isArray(target.requiredFields) ? (target.requiredFields as string[]) : [],
      );
      if (missing.length > 0) throw unprocessable(requiredFieldsMessage(target.name, missing), 'REQUIRED_FIELDS', { missing });
    }
    if (changing && target.stageType === 'cancelled') {
      const result = await cancelWithDeposits(ctx, tx, os, now);
      await moveServiceOrder(tx, os, target, { userId: ctx.user.id, now });
      await auditCancelled(ctx, tx, os, target, result);
    } else {
      await moveServiceOrder(tx, os, target, { userId: ctx.user.id, now, position: input.position, afterId: input.afterId });
    }
    return { changed: changing, target };
  });
  const detail = await getDetail(ctx, id);
  return { ...detail, moved: outcome.changed };
}

async function receiveDeposit(ctx: Ctx) {
  const id = requireUuid(ctx.params.id);
  const input = parse(serviceOrderDepositSchema, ctx.body);
  const config = await loadFeeConfig(ctx.deps.db);
  const now = ctx.deps.clock.now();
  await ctx.deps.db.$transaction(async (tx) => {
    const session = await requireOpenSession(tx);
    const os = await lockServiceOrder(tx, id, serviceOrderScope(ctx));
    assertEditable(os);
    const totalCents = serviceOrderTotal(os);
    if (totalCents <= 0) throw unprocessable('Lance o orçamento antes de receber sinal.', 'QUOTE_EMPTY');
    const depositCents = activeDeposits(os).reduce((sum, payment) => sum + payment.coveredCents, 0);
    const balanceCents = totalCents - depositCents;
    if (balanceCents <= 0) throw conflict('Esta OS já está paga. Use "Receber e entregar" para finalizar.');
    const checkout = checkoutOrThrow(balanceCents, input.payments, config);
    await recordPayments(tx, {
      session,
      lines: checkout.lines,
      serviceOrderId: os.id,
      userId: ctx.user.id,
      now,
      ref: { type: 'ServiceOrder', id: os.id, number: os.number },
      description: `Sinal da OS ${os.number}`,
    });
    const methods = checkout.lines.map((line) => ({ method: line.method, installments: line.installments, coveredCents: line.coveredCents }));
    await addEvent(tx, id, { type: 'payment', userId: ctx.user.id, now, data: { receivedCents: checkout.coveredCents, methods } });
    await audit(tx, {
      userId: ctx.user.id,
      action: 'os.deposit',
      entity: 'ServiceOrder',
      entityId: id,
      after: { number: os.number, receivedCents: checkout.coveredCents, feeCents: checkout.feeCents, balanceCents: balanceCents - checkout.coveredCents },
      ip: ctx.ip,
    });
  });
  return getDetail(ctx, id);
}

async function deliver(ctx: Ctx) {
  const id = requireUuid(ctx.params.id);
  const input = parse(serviceOrderCheckoutSchema, ctx.body);
  const config = await loadFeeConfig(ctx.deps.db);
  const now = ctx.deps.clock.now();
  const result = await ctx.deps.db.$transaction(async (tx) => {
    const session = await requireOpenSession(tx);
    const os = await lockServiceOrder(tx, id, serviceOrderScope(ctx));
    return deliverServiceOrder(tx, os, {
      payments: input.payments,
      allowPending: input.allowPending,
      userId: ctx.user.id,
      now,
      config,
      session,
      ip: ctx.ip,
      authorizePending: async () => {
        const approver = await ctx.approve('sale.allow_pending', 'Deixar saldo a receber precisa de autorização.');
        return approver?.id ?? null;
      },
      checkpoint: (name) => failpoint(ctx.deps, name),
    });
  });
  const detail = await getDetail(ctx, id);
  return { ...detail, delivery: result };
}

async function findVisible(ctx: Ctx, id: string) {
  const os = await ctx.deps.db.serviceOrder.findFirst({
    where: { AND: [{ id }, serviceOrderScope(ctx)] },
    select: { id: true, number: true, columnId: true, unlockType: true, unlockSecretEnc: true },
  });
  if (!os) throw notFound('OS não encontrada.');
  return os;
}

async function revealSecret(ctx: Ctx) {
  const id = requireUuid(ctx.params.id);
  const os = await findVisible(ctx, id);
  if (!os.unlockSecretEnc) throw notFound('Esta OS não tem senha de desbloqueio registrada.');
  const secret = decryptSecret(os.unlockSecretEnc, ctx.deps.config.secretEncryptionKey);
  const now = ctx.deps.clock.now();
  await ctx.deps.db.$transaction(async (tx) => {
    await addEvent(tx, id, { type: 'secret_viewed', userId: ctx.user.id, now });
    await audit(tx, { userId: ctx.user.id, action: 'os.secret_viewed', entity: 'ServiceOrder', entityId: id, after: { number: os.number }, ip: ctx.ip });
  });
  return { unlockType: os.unlockType, secret };
}

async function logWhatsapp(ctx: Ctx) {
  const id = requireUuid(ctx.params.id);
  const input = parse(whatsappLogSchema, ctx.body);
  const os = await findVisible(ctx, id);
  await ctx.deps.db.$transaction((tx) =>
    addEvent(tx, id, { type: 'whatsapp_opened', userId: ctx.user.id, now: ctx.deps.clock.now(), data: { context: input.context ?? null, columnId: os.columnId } }),
  );
  return { ok: true };
}

async function logPrint(ctx: Ctx) {
  const id = requireUuid(ctx.params.id);
  const input = parse(serviceOrderPrintSchema, ctx.body);
  await findVisible(ctx, id);
  await ctx.deps.db.$transaction((tx) => addEvent(tx, id, { type: 'printed', userId: ctx.user.id, now: ctx.deps.clock.now(), data: { kind: input.kind } }));
  return { ok: true };
}

export function serviceOrderRoutes(r: Router) {
  r.get('/api/service-orders/board', [...OS_ACCESS], board);
  r.post('/api/service-orders', 'os.edit', createServiceOrder);
  r.get('/api/service-orders/:id', [...OS_ACCESS], (ctx) => getDetail(ctx, requireUuid(ctx.params.id)));
  r.put('/api/service-orders/:id', 'os.edit', updateServiceOrder);
  r.put('/api/service-orders/:id/items', 'os.quote_edit', saveQuote);
  r.post('/api/service-orders/:id/approval', ['os.edit', 'os.quote_edit'], registerApproval);
  r.post('/api/service-orders/:id/move', 'os.move', moveOrder);
  r.post('/api/service-orders/:id/deposit', 'sale.create', receiveDeposit);
  r.post('/api/service-orders/:id/deliver', 'sale.create', deliver);
  r.post('/api/service-orders/:id/secret', 'os.unlock_secret.view', revealSecret);
  r.post('/api/service-orders/:id/whatsapp', [...OS_ACCESS], logWhatsapp);
  r.post('/api/service-orders/:id/print', [...OS_ACCESS], logPrint);
}
