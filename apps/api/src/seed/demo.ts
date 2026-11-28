import { addDays, closeCash, computeCheckout, startOfDay, type PaymentInput } from '@loja/shared';
import type { Db, Tx } from '../db.ts';
import { nextNumber } from '../lib/counter.ts';
import { recordPayments, reversePayments, sessionExpected } from '../services/cash.ts';
import { priceItems } from '../services/sales.ts';
import { loadFeeConfig } from '../services/settings.ts';
import { applyStockChange } from '../services/stock.ts';
import { createServiceOrderSeeder } from './service-orders.ts';
import type { seedBase } from './base.ts';
import type { seedCatalog } from './catalog.ts';

type Base = Awaited<ReturnType<typeof seedBase>>;
type Catalog = Awaited<ReturnType<typeof seedCatalog>>;

const COUNTER_SKUS = ['PEL-IP13', 'PEL-A54', 'PEL-HIDRO', 'CAP-IP13', 'CAP-S23', 'CAR-25W', 'CAR-20W', 'CAB-CC1', 'CAB-LTG1', 'FON-TWS', 'FON-P2', 'ACE-SUPM', 'ACE-SD64', 'CAR-VEIC'];
const MINUTE = 60000;

function random(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoSale {
  at: Date;
  sellerId: string;
  sessionId: string;
  items: { productId: string; qty: number }[];
  pay: (totalCents: number) => PaymentInput[];
  customerId?: string | null;
  pending?: boolean;
  approvedById?: string | null;
}

async function createDemoSale(tx: Tx, sale: DemoSale) {
  const products = new Map((await tx.product.findMany({ where: { id: { in: sale.items.map((entry) => entry.productId) } } })).map((row) => [row.id, row]));
  const available = sale.items.filter((entry) => (products.get(entry.productId)?.stockQty ?? 0) >= entry.qty);
  if (available.length === 0) return null;
  const pricing = priceItems(
    available.map((entry) => ({ productId: entry.productId, name: products.get(entry.productId)!.name, qty: entry.qty, unitPriceCents: products.get(entry.productId)!.priceCents })),
    products,
  );
  const checkout = computeCheckout(pricing.cart.totalCents, sale.pay(pricing.cart.totalCents), await loadFeeConfig(tx));
  if (checkout.errors.length > 0) throw new Error(checkout.errors[0]);
  const number = await nextNumber(tx, 'sale');
  const created = await tx.sale.create({
    data: {
      number,
      status: checkout.remainingCents > 0 ? 'pending' : 'completed',
      origin: 'counter',
      customerId: sale.customerId ?? null,
      sellerId: sale.sellerId,
      subtotalCents: pricing.cart.grossCents,
      discountCents: pricing.cart.discountCents,
      totalCents: pricing.cart.totalCents,
      paidCents: checkout.coveredCents,
      costCents: pricing.cart.costCents,
      completedAt: sale.at,
      approvedById: sale.approvedById ?? null,
      createdAt: sale.at,
    },
  });
  await tx.saleItem.createMany({ data: pricing.items.map((entry) => ({ ...entry, saleId: created.id })) });
  for (const entry of pricing.items) {
    if (!entry.productId || !entry.tracksStock) continue;
    const movement = await applyStockChange(tx, {
      productId: entry.productId,
      qty: -entry.qty,
      type: 'sale',
      userId: sale.sellerId,
      refType: 'Sale',
      refId: created.id,
      refNumber: number,
    });
    if (movement) await tx.stockMovement.update({ where: { id: movement.id }, data: { createdAt: sale.at } });
  }
  await recordPayments(tx, {
    session: { id: sale.sessionId },
    lines: checkout.lines,
    saleId: created.id,
    userId: sale.sellerId,
    approvedById: sale.approvedById ?? null,
    now: sale.at,
    ref: { type: 'Sale', id: created.id, number },
    description: `Venda ${number}`,
  });
  await tx.auditLog.create({
    data: { userId: sale.sellerId, approvedById: sale.approvedById ?? null, action: 'sale.completed', entity: 'Sale', entityId: created.id, after: { number, status: created.status, totalCents: created.totalCents, paidCents: created.paidCents }, createdAt: sale.at },
  });
  return created;
}

const DEMO_FEE_BPS: Record<string, number> = { 'pix:1': 99, 'debit:1': 199, 'credit:1': 349, 'credit:2': 449, 'credit:3': 499 };

function demoFeeBps(method: string, installments: number): number {
  if (method === 'credit' && installments > 3) return 499 + (installments - 3) * 50;
  return DEMO_FEE_BPS[`${method}:${installments}`] ?? 0;
}

async function seedDemoFees(db: Db) {
  const rules = await db.feeRule.findMany();
  for (const rule of rules) {
    await db.feeRule.update({ where: { id: rule.id }, data: { percentBps: demoFeeBps(rule.method, rule.installments) } });
  }
}

export async function seedDemo(db: Db, base: Base, catalog: Catalog): Promise<void> {
  await seedDemoFees(db);
  const rand = random(20261126);
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)]!;
  const ana = base.users.get('ana')!;
  const owner = base.users.get('admin')!;
  const customers = [...catalog.customers.values()];
  const counterProducts = COUNTER_SKUS.map((sku) => catalog.products.get(sku)!).filter(Boolean);
  const categories = new Map((await db.expenseCategory.findMany()).map((row) => [row.name, row.id]));
  const now = new Date();
  const today = startOfDay(now);

  const payFor = (totalCents: number): PaymentInput[] => {
    const roll = rand();
    if (roll < 0.38) return [{ method: 'pix', amountCents: totalCents }];
    if (roll < 0.6) return [{ method: 'cash', amountCents: Math.ceil(totalCents / 1000) * 1000 + (rand() < 0.4 ? 5000 : 0) }];
    if (roll < 0.75) return [{ method: 'debit', amountCents: totalCents }];
    if (roll < 0.9) return [{ method: 'credit', installments: totalCents > 10000 ? pick([1, 2, 3]) : 1, amountCents: totalCents }];
    const pix = Math.round(totalCents / 2);
    return [
      { method: 'pix', amountCents: pix },
      { method: 'cash', amountCents: totalCents - pix },
    ];
  };

  const basket = () => {
    const count = rand() < 0.65 ? 1 : rand() < 0.8 ? 2 : 3;
    const chosen = new Set<string>();
    while (chosen.size < count) chosen.add(pick(counterProducts));
    return [...chosen].map((productId) => ({ productId, qty: rand() < 0.1 ? 2 : 1 }));
  };

  const isSunday = (offset: number) => new Date(addDays(today, -offset).getTime() + 12 * 60 * MINUTE).getUTCDay() === 0;
  const businessOffsets = Array.from({ length: 13 }, (_, index) => 12 - index).filter((offset) => offset === 0 || !isSunday(offset));
  const serviceOrders = await createServiceOrderSeeder(db, catalog, businessOffsets);

  for (const offset of businessOffsets) {
    const dayStart = addDays(today, -offset);
    const isToday = offset === 0;
    const openedAt = isToday ? new Date(Math.min(now.getTime() - 4 * 60 * MINUTE, dayStart.getTime() + (8 * 60 + 12) * MINUTE)) : new Date(dayStart.getTime() + (8 * 60 + Math.floor(rand() * 20)) * MINUTE);
    const session = await db.cashSession.create({
      data: { status: 'open', openedById: ana, openedAt, openingCents: pick([15000, 20000, 20000]), createdAt: openedAt },
    });
    await db.auditLog.create({ data: { userId: ana, action: 'cash.opened', entity: 'CashSession', entityId: session.id, after: { openingCents: session.openingCents }, createdAt: openedAt } });

    const closesAt = isToday ? now : new Date(dayStart.getTime() + (18 * 60 + 30) * MINUTE);
    const span = closesAt.getTime() - openedAt.getTime() - 40 * MINUTE;
    const salesCount = isToday ? 4 : 4 + Math.floor(rand() * 6);
    const times = Array.from({ length: salesCount }, () => new Date(openedAt.getTime() + 20 * MINUTE + Math.floor(rand() * span))).sort((a, b) => a.getTime() - b.getTime());

    await db.$transaction(async (tx) => {
      for (const at of times) {
        await createDemoSale(tx, {
          at,
          sellerId: rand() < 0.7 ? ana : owner,
          sessionId: session.id,
          items: basket(),
          pay: payFor,
          customerId: rand() < 0.35 ? pick(customers) : null,
        });
      }
      if (offset === 3) {
        await createDemoSale(tx, {
          at: new Date(openedAt.getTime() + 5 * 60 * MINUTE),
          sellerId: ana,
          sessionId: session.id,
          items: [{ productId: catalog.products.get('FON-TWS')!, qty: 1 }, { productId: catalog.products.get('CAR-25W')!, qty: 1 }],
          pay: (totalCents) => [{ method: 'pix', amountCents: Math.round(totalCents / 2) }],
          customerId: catalog.customers.get('Thiago Barbosa') ?? customers[0]!,
          approvedById: owner,
        });
      }
      if (offset === 8) {
        const at = new Date(openedAt.getTime() + 3 * 60 * MINUTE);
        const sale = await createDemoSale(tx, {
          at,
          sellerId: ana,
          sessionId: session.id,
          items: [{ productId: catalog.products.get('CAR-20W')!, qty: 1 }],
          pay: (totalCents) => [{ method: 'debit', amountCents: totalCents }],
        });
        if (sale) {
          const cancelledAt = new Date(at.getTime() + 25 * MINUTE);
          const reason = 'Cliente trocou por outro modelo';
          for (const entry of await tx.saleItem.findMany({ where: { saleId: sale.id } })) {
            if (!entry.productId || !entry.tracksStock) continue;
            const movement = await applyStockChange(tx, { productId: entry.productId, qty: entry.qty, type: 'reversal', userId: owner, reason, refType: 'Sale', refId: sale.id, refNumber: sale.number });
            if (movement) await tx.stockMovement.update({ where: { id: movement.id }, data: { createdAt: cancelledAt } });
          }
          const reversed = await reversePayments(tx, {
            session: { id: session.id },
            payments: await tx.payment.findMany({ where: { saleId: sale.id } }),
            userId: owner,
            now: cancelledAt,
            ref: { type: 'Sale', id: sale.id, number: sale.number },
            description: `Estorno da venda ${sale.number}`,
          });
          await tx.sale.update({ where: { id: sale.id }, data: { status: 'cancelled', cancelReason: reason, cancelledAt, cancelledById: owner } });
          await tx.auditLog.create({
            data: { userId: owner, action: 'sale.cancelled', entity: 'Sale', entityId: sale.id, before: { status: 'completed' }, after: { status: 'cancelled', reason, reversedCents: reversed.amountCents }, createdAt: cancelledAt },
          });
        }
      }
      if (!isToday && rand() < 0.45) {
        await tx.cashMovement.create({
          data: {
            sessionId: session.id,
            type: 'expense',
            method: 'cash',
            amountCents: pick([1800, 2500, 3200]),
            fromDrawer: true,
            categoryId: categories.get('Alimentação') ?? null,
            description: 'Lanche da equipe',
            userId: ana,
            occurredAt: new Date(openedAt.getTime() + 4 * 60 * MINUTE),
          },
        });
      }
      if (offset === 6) {
        await tx.cashMovement.create({
          data: {
            sessionId: session.id,
            type: 'expense',
            method: 'pix',
            amountCents: 18990,
            fromDrawer: false,
            categoryId: categories.get('Internet') ?? null,
            description: 'Mensalidade da internet',
            userId: owner,
            occurredAt: new Date(openedAt.getTime() + 2 * 60 * MINUTE),
          },
        });
      }
    });

    await serviceOrders.runDay(offset, openedAt, closesAt);
    if (isToday) continue;
    const { expected } = await sessionExpected(db, session);
    if (expected.cash > 25000) {
      const amountCents = Math.floor((expected.cash - 15000) / 5000) * 5000;
      if (amountCents > 0) {
        await db.cashMovement.create({
          data: { sessionId: session.id, type: 'withdrawal', method: 'cash', amountCents, fromDrawer: true, description: 'Sangria para o cofre', userId: owner, approvedById: null, occurredAt: new Date(closesAt.getTime() - 10 * MINUTE) },
        });
      }
    }
    const final = (await sessionExpected(db, session)).expected;
    const differenceCents = offset === 5 ? -250 : 0;
    const closing = closeCash(final.cash, final.cash + differenceCents);
    await db.cashSession.update({
      where: { id: session.id },
      data: {
        status: 'closed',
        closedById: offset % 2 === 0 ? ana : owner,
        closedAt: closesAt,
        countedCashCents: closing.countedCashCents,
        expectedCashCents: closing.expectedCashCents,
        expected: final,
        differenceCents: closing.differenceCents,
        notes: differenceCents !== 0 ? 'Faltaram moedas de R$ 0,50 e R$ 1,00 no troco.' : null,
      },
    });
    await db.auditLog.create({ data: { userId: ana, action: 'cash.closed', entity: 'CashSession', entityId: session.id, after: { ...closing }, createdAt: closesAt } });
  }

  const quoteFrom = async (daysAgo: number, customerName: string, skus: string[], validityDays: number) => {
    const createdAt = new Date(now.getTime() - daysAgo * 24 * 60 * MINUTE);
    const ids = skus.map((sku) => catalog.products.get(sku)!);
    const products = new Map((await db.product.findMany({ where: { id: { in: ids } } })).map((row) => [row.id, row]));
    const pricing = priceItems(ids.map((id) => ({ productId: id, name: products.get(id)!.name, qty: 1, unitPriceCents: products.get(id)!.priceCents })), products);
    await db.$transaction(async (tx) => {
      const quote = await tx.sale.create({
        data: {
          quoteNumber: await nextNumber(tx, 'quote'),
          status: 'quote',
          origin: 'counter',
          customerId: catalog.customers.get(customerName) ?? null,
          sellerId: ana,
          subtotalCents: pricing.cart.grossCents,
          discountCents: 0,
          totalCents: pricing.cart.totalCents,
          costCents: pricing.cart.costCents,
          quoteCreatedAt: createdAt,
          quoteValidUntil: new Date(createdAt.getTime() + validityDays * 24 * 60 * MINUTE),
          createdAt,
        },
      });
      await tx.saleItem.createMany({ data: pricing.items.map((entry) => ({ ...entry, saleId: quote.id })) });
    });
  };
  await quoteFrom(2, 'Camila Rocha', ['FON-TWS', 'CAP-IP13', 'PEL-IP13'], 7);
  await quoteFrom(10, 'Lucas Martins', ['CAR-25W', 'CAB-CC1'], 7);
  await serviceOrders.close();
}
