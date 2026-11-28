import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProduct, item, setupTestApp, type Client, type TestApp } from './helpers.ts';

let t: TestApp;
let owner: Client;
let cashier: Client;
let admin: Client;

beforeAll(async () => {
  t = await setupTestApp();
  admin = await t.login('admin');
  owner = await t.login('admin');
  cashier = await t.login('ana');
});

afterAll(async () => {
  await t.app.close();
});

describe('D: fechamento de caixa', () => {
  it('abertura 100, venda C, sangria 30, custo 20 da gaveta, contado 95', async () => {
    expect((await cashier.post('/api/cash/open', { openingCents: 10000 })).status).toBe(200);
    const product = await createProduct(t.db, { name: 'Capinha antiimpacto', priceCents: 5000, costCents: 2000 });
    const sale = await cashier.post('/api/sales', { items: [item(product)], payments: [{ method: 'cash', amountCents: 10000 }] });
    expect(sale.status).toBe(200);

    expect((await cashier.post('/api/cash/withdrawals', { type: 'withdrawal', amountCents: 3000, description: 'Sangria para o cofre' })).body.error.code).toBe(
      'APPROVAL_REQUIRED',
    );
    const withdrawal = await owner.post('/api/cash/withdrawals', { type: 'withdrawal', amountCents: 3000, description: 'Sangria para o cofre' });
    expect(withdrawal.status).toBe(200);
    expect(withdrawal.body.method).toBe('cash');

    const category = await t.db.expenseCategory.findFirstOrThrow({ where: { active: true } });
    const expense = await owner.post('/api/cash/expenses', {
      type: 'expense',
      amountCents: 2000,
      description: 'Lanche da equipe',
      categoryId: category.id,
      method: 'cash',
      fromDrawer: true,
    });
    expect(expense.status).toBe(200);
    expect(expense.body.fromDrawer).toBe(true);

    const current = await owner.get('/api/cash/current');
    expect(current.body.session.expectedNow.cash).toBe(10000);

    const noNote = await cashier.post('/api/cash/close', { countedCashCents: 9500 });
    expect(noNote.status).toBe(400);
    expect(noNote.body.error.details.issues[0].path).toBe('notes');

    const closed = await cashier.post('/api/cash/close', { countedCashCents: 9500, notes: 'Faltou troco de moedas' });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('closed');
    expect(closed.body.expectedCashCents).toBe(10000);
    expect(closed.body.differenceCents).toBe(-500);

    const home = await owner.get('/api/dashboard?period=today');
    expect(home.body.summary.receivedCents).toBe(5000);
    expect(home.body.summary.cmvCents).toBe(2000);
    expect(home.body.summary.expenseCents).toBe(2000);
    expect(home.body.summary.withdrawalCents).toBe(3000);
    expect(home.body.summary.resultCents).toBe(1000);
    expect(home.body.drawer).toBeNull();

    expect(await t.db.auditLog.count({ where: { action: { in: ['cash.opened', 'cash.closed', 'cash.withdrawal', 'cash.expense'] } } })).toBe(4);
  });

  it('caixa fechado fica somente leitura', async () => {
    const response = await owner.post('/api/cash/entries', { type: 'supply', amountCents: 1000, description: 'Troco' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CASH_CLOSED');
  });

  it('reabrir exige permissão e motivo e fica no log', async () => {
    const [session] = (await owner.get('/api/cash/sessions')).body.items;
    expect(session.differenceCents).toBe(-500);
    expect(session.closedByName).toBe('Ana Souza');
    const denied = await cashier.post(`/api/cash/sessions/${session.id}/reopen`, { reason: 'Lançar custo esquecido' });
    expect(denied.body.error.code).toBe('APPROVAL_REQUIRED');
    const reopened = await admin.post(`/api/cash/sessions/${session.id}/reopen`, { reason: 'Lançar custo esquecido' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.status).toBe('open');
    expect(reopened.body.differenceCents).toBeNull();
    const log = await t.db.auditLog.findFirstOrThrow({ where: { action: 'cash.reopened' } });
    expect(log.entityId).toBe(session.id);
    const closed = await cashier.post('/api/cash/close', { countedCashCents: 10000 });
    expect(closed.status).toBe(200);
    expect(closed.body.differenceCents).toBe(0);
  });

  it('entradas: receita entra no resultado, suprimento não', async () => {
    expect((await cashier.post('/api/cash/open', { openingCents: 0 })).status).toBe(200);
    const before = (await owner.get('/api/dashboard?period=today')).body.summary;
    expect((await cashier.post('/api/cash/entries', { type: 'income', method: 'pix', amountCents: 4000, description: 'Venda de sucata' })).status).toBe(200);
    expect((await cashier.post('/api/cash/entries', { type: 'supply', method: 'pix', amountCents: 5000, description: 'Troco do cofre' })).status).toBe(200);
    expect((await cashier.post('/api/cash/entries', { type: 'withdrawal', amountCents: 100, description: 'x' })).status).toBe(400);
    const after = (await owner.get('/api/dashboard?period=today')).body;
    expect(after.summary.incomeCents - before.incomeCents).toBe(4000);
    expect(after.summary.supplyCents - before.supplyCents).toBe(5000);
    expect(after.summary.resultCents - before.resultCents).toBe(4000);
    expect(after.drawer.expectedCashCents).toBe(5000);
    const current = (await owner.get('/api/cash/current')).body.session;
    expect(current.expectedNow.pix).toBe(4000);
  });

  it('custo fora da gaveta não mexe no dinheiro esperado', async () => {
    const category = await t.db.expenseCategory.findFirstOrThrow({ where: { active: true } });
    const response = await owner.post('/api/cash/expenses', {
      type: 'expense',
      amountCents: 7000,
      description: 'Conta de luz',
      categoryId: category.id,
      method: 'pix',
      fromDrawer: true,
    });
    expect(response.status).toBe(200);
    expect(response.body.fromDrawer).toBe(false);
    expect((await owner.get('/api/cash/current')).body.session.expectedNow.cash).toBe(5000);
  });
});
