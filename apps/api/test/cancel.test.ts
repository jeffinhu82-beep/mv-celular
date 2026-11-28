import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createProduct, item, setupTestApp, tableCounts, type Client, type TestApp } from './helpers.ts';

let t: TestApp;
let owner: Client;
let cashier: Client;

beforeAll(async () => {
  t = await setupTestApp();
  owner = await t.login('admin');
  cashier = await t.login('ana');
  expect((await cashier.post('/api/cash/open', { openingCents: 10000 })).status).toBe(200);
});

afterEach(() => {
  t.deps.failpoints.clear();
});

afterAll(async () => {
  await t.app.close();
});

describe('F: cancelamento', () => {
  it('cancela a venda A no mesmo dia: devolve estoque, estorna valor e taxa, resumo volta', async () => {
    const product = await createProduct(t.db, { name: 'Fone Bluetooth', priceCents: 30000, costCents: 12000, stockQty: 3 });
    const baseline = (await owner.get('/api/dashboard?period=today')).body.summary;
    const sale = await owner.post('/api/sales', { items: [item(product)], payments: [{ method: 'credit', installments: 3, amountCents: 30000 }] });
    expect(sale.status).toBe(200);
    const during = (await owner.get('/api/dashboard?period=today')).body.summary;
    expect(during.receivedCents - baseline.receivedCents).toBe(30000);
    expect(during.feeCents - baseline.feeCents).toBe(1497);

    expect((await owner.post(`/api/sales/${sale.body.id}/cancel`, {})).status).toBe(400);
    expect((await cashier.post(`/api/sales/${sale.body.id}/cancel`, { reason: 'Cliente desistiu' })).status).toBe(403);
    const cancelled = await owner.post(`/api/sales/${sale.body.id}/cancel`, { reason: 'Cliente desistiu' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
    expect(cancelled.body.cancelReason).toBe('Cliente desistiu');
    expect((await t.db.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty).toBe(3);

    const reversal = await t.db.cashMovement.findFirstOrThrow({ where: { type: 'reversal', refId: sale.body.id } });
    expect(reversal.amountCents).toBe(30000);
    expect(reversal.feeCents).toBe(1497);
    expect(reversal.method).toBe('credit');

    const after = (await owner.get('/api/dashboard?period=today')).body.summary;
    for (const key of ['receivedCents', 'feeCents', 'cmvCents', 'resultCents', 'salesCount', 'salesTotalCents'] as const) {
      expect(after[key], key).toBe(baseline[key]);
    }
    const log = await t.db.auditLog.findFirstOrThrow({ where: { action: 'sale.cancelled', entityId: sale.body.id } });
    expect(log.after).toMatchObject({ reason: 'Cliente desistiu', reversedCents: 30000, reversedFeeCents: 1497 });
    expect((await owner.post(`/api/sales/${sale.body.id}/cancel`, { reason: 'De novo' })).status).toBe(409);
  });

  it('estorno de venda de outro dia entra no caixa atual, e o resultado do dia da venda não muda', async () => {
    const product = await createProduct(t.db, { name: 'Carregador sem fio', priceCents: 12000, costCents: 5000 });
    const sale = await owner.post('/api/sales', { items: [item(product)], payments: [{ method: 'cash', amountCents: 12000 }] });
    expect(sale.status).toBe(200);
    const dayOne = (await owner.get('/api/dashboard?period=today')).body.summary;
    expect((await cashier.post('/api/cash/close', { countedCashCents: (await owner.get('/api/cash/current')).body.session.expectedNow.cash })).status).toBe(200);

    t.clock.set('2026-11-27T13:00:00Z');
    owner = await t.login('admin');
    cashier = await t.login('ana');
    expect((await cashier.post('/api/cash/open', { openingCents: 20000 })).status).toBe(200);
    const cancelled = await owner.post(`/api/sales/${sale.body.id}/cancel`, { reason: 'Defeito de fábrica' });
    expect(cancelled.status).toBe(200);
    const current = (await owner.get('/api/cash/current')).body.session;
    expect(current.expectedNow.cash).toBe(8000);
    const today = (await owner.get('/api/dashboard?period=today')).body.summary;
    expect(today.receivedCents).toBe(-12000);
    expect(today.cmvCents).toBe(-5000);
    expect(today.resultCents).toBe(-7000);
    const yesterday = (await owner.get('/api/dashboard?period=yesterday')).body.summary;
    expect(yesterday.receivedCents).toBe(dayOne.receivedCents);
    expect(yesterday.cmvCents).toBe(dayOne.cmvCents);
  });
});

describe('transação: falha no meio não deixa dado pela metade', () => {
  const body = (productId: string, name: string) => ({
    items: [{ productId, name, qty: 1, unitPriceCents: 4000 }],
    payments: [{ method: 'pix', amountCents: 4000 }],
  });

  for (const point of ['sale.after_stock', 'sale.after_payments']) {
    it(`venda com falha em ${point}`, async () => {
      const product = await createProduct(t.db, { name: `Produto ${point}`, priceCents: 4000, stockQty: 5 });
      const before = await tableCounts(t.db);
      t.deps.failpoints.add(point);
      const response = await owner.post('/api/sales', body(product.id, product.name));
      expect(response.status).toBe(500);
      expect(await tableCounts(t.db)).toEqual(before);
    });
  }

  for (const point of ['cancel.after_stock', 'cancel.after_reversal']) {
    it(`cancelamento com falha em ${point}`, async () => {
      const product = await createProduct(t.db, { name: `Produto ${point}`, priceCents: 4000, stockQty: 5 });
      const sale = await owner.post('/api/sales', body(product.id, product.name));
      expect(sale.status).toBe(200);
      const before = await tableCounts(t.db);
      t.deps.failpoints.add(point);
      const response = await owner.post(`/api/sales/${sale.body.id}/cancel`, { reason: 'Teste de falha' });
      expect(response.status).toBe(500);
      expect(await tableCounts(t.db)).toEqual(before);
      expect((await t.db.sale.findUniqueOrThrow({ where: { id: sale.body.id } })).status).toBe('completed');
      expect(await t.db.payment.count({ where: { saleId: sale.body.id, reversedAt: { not: null } } })).toBe(0);
    });
  }

  it('fechamento com falha mantém o caixa aberto', async () => {
    t.deps.failpoints.add('cash.close.before_update');
    const expected = (await owner.get('/api/cash/current')).body.session.expectedNow.cash;
    const before = await tableCounts(t.db);
    const response = await cashier.post('/api/cash/close', { countedCashCents: expected });
    expect(response.status).toBe(500);
    expect(await tableCounts(t.db)).toEqual(before);
    expect((await cashier.get('/api/cash/status')).body.session).not.toBeNull();
  });
});
