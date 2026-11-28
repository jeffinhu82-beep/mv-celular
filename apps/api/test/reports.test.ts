import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProduct, item, setupTestApp, type Client, type TestApp } from './helpers.ts';

let t: TestApp;
let owner: Client;
let cashier: Client;
let diego: Client;
let analyst: Client;
let customerId: string;

const MONTH = 'period=range&from=2026-11-01&to=2026-11-30';

function column(name: string) {
  const id = t.base.columns.get(name);
  if (!id) throw new Error(`Coluna ${name} não existe no seed`);
  return id;
}

async function newOrder(technician: string) {
  const response = await owner.post('/api/service-orders', {
    customerId,
    deviceType: 'Celular',
    brand: 'Motorola',
    model: 'Moto G84',
    reportedIssue: 'Não carrega',
    technicianId: t.base.users.get(technician),
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect((await owner.put(`/api/service-orders/${response.body.id}`, { diagnosis: 'Conector de carga oxidado.' })).status).toBe(200);
  return response.body as { id: string };
}

async function moveTo(id: string, name: string) {
  const response = await diego.post(`/api/service-orders/${id}/move`, { columnId: column(name), position: 0 });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

async function at(iso: string) {
  t.clock.set(iso);
  owner = await t.login('admin');
  cashier = await t.login('ana');
  diego = await t.login('diego');
}

beforeAll(async () => {
  t = await setupTestApp({ now: '2026-11-10T12:00:00Z' });
  owner = await t.login('admin');
  cashier = await t.login('ana');
  diego = await t.login('diego');
  customerId = (await t.db.customer.create({ data: { name: 'Paulo Rezende', phoneE164: '+5511988887777' } })).id;

  const role = await owner.post('/api/roles', { name: 'Analista', discountLimitBps: 0, permissions: ['report.view'] });
  expect(role.status, JSON.stringify(role.body)).toBe(200);
  const created = await owner.post('/api/users', { name: 'Lívia Prado', login: 'livia', email: 'livia@loja.test', roleId: role.body.id, temporaryPassword: 'temporaria1' });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const first = await t.login('livia', 'temporaria1');
  expect((await first.post('/api/auth/change-password', { currentPassword: 'temporaria1', newPassword: 'analista123' })).status).toBe(200);

  expect((await cashier.post('/api/cash/open', { openingCents: 10000 })).status).toBe(200);
  const case_ = await createProduct(t.db, { name: 'Capinha transparente', priceCents: 5000, costCents: 1500, stockQty: 50 });
  const charger = await createProduct(t.db, { name: 'Carregador 20W', priceCents: 3000, costCents: 1200, stockQty: 50 });

  await at('2026-11-10T13:00:00Z');
  expect((await cashier.post('/api/sales', { items: [item(case_)], payments: [{ method: 'cash', amountCents: 5000 }] })).status).toBe(200);

  await at('2026-11-11T02:30:00Z');
  const late = await owner.post('/api/sales', { items: [item(charger)], payments: [{ method: 'pix', amountCents: 3000 }] });
  expect(late.status, JSON.stringify(late.body)).toBe(200);

  await at('2026-11-12T15:00:00Z');
  const credit = await owner.post('/api/sales', { items: [item(case_, 2)], payments: [{ method: 'credit', installments: 1, amountCents: 10000 }] });
  expect(credit.status, JSON.stringify(credit.body)).toBe(200);

  const category = await t.db.expenseCategory.findFirstOrThrow({ where: { active: true } });
  const expense = await owner.post('/api/cash/expenses', { type: 'expense', amountCents: 2500, description: 'Material de limpeza', categoryId: category.id, method: 'cash', fromDrawer: true });
  expect(expense.status, JSON.stringify(expense.body)).toBe(200);

  await at('2026-11-12T21:00:00Z');
  expect((await cashier.post('/api/cash/close', { countedCashCents: 12500 })).status).toBe(200);

  await at('2026-11-13T12:00:00Z');
  const quick = await newOrder('diego');
  const slow = await newOrder('diego');
  await newOrder('rafael');
  await at('2026-11-13T17:00:00Z');
  await moveTo(quick.id, 'Pronto para retirada');
  await at('2026-11-14T12:00:00Z');
  await moveTo(quick.id, 'Em análise');
  await at('2026-11-14T13:00:00Z');
  await moveTo(quick.id, 'Pronto para retirada');
  await at('2026-11-15T12:00:00Z');
  await moveTo(slow.id, 'Pronto para retirada');
  await at('2026-11-20T12:00:00Z');
  analyst = await t.login('livia', 'analista123');
});

afterAll(async () => {
  await t.app.close();
});

describe('relatório de vendas', () => {
  it('agrupa por dia no fuso de São Paulo e bate com o resumo da Início', async () => {
    const report = await owner.get(`/api/reports/sales?${MONTH}`);
    expect(report.status).toBe(200);
    const day = (key: string) => report.body.byDay.find((row: { day: string }) => row.day === key);
    expect(report.body.byDay).toHaveLength(30);
    expect(day('2026-11-10')).toEqual({ day: '2026-11-10', count: 2, totalCents: 8000 });
    expect(day('2026-11-11')).toEqual({ day: '2026-11-11', count: 0, totalCents: 0 });
    expect(day('2026-11-12')).toEqual({ day: '2026-11-12', count: 1, totalCents: 10000 });

    const home = await owner.get(`/api/dashboard?${MONTH}`);
    expect(report.body.totals.count).toBe(home.body.summary.salesCount);
    expect(report.body.totals.totalCents).toBe(home.body.summary.salesTotalCents);
    expect(report.body.totals.averageTicketCents).toBe(home.body.summary.averageTicketCents);
    expect(report.body.totals.receivedCents).toBe(home.body.summary.receivedCents);
  });

  it('separa por vendedor, forma de pagamento e produto', async () => {
    const report = (await owner.get(`/api/reports/sales?${MONTH}`)).body;
    expect(report.bySeller.map((row: { name: string; count: number; totalCents: number }) => [row.name, row.count, row.totalCents])).toEqual([
      ['Carlos Menezes', 2, 13000],
      ['Ana Souza', 1, 5000],
    ]);
    const methods = Object.fromEntries(report.byMethod.map((row: { method: string; grossCents: number }) => [row.method, row.grossCents]));
    expect(methods).toEqual({ cash: 5000, pix: 3000, credit: expect.any(Number) });
    expect(report.byMethod.find((row: { method: string }) => row.method === 'credit').feeCents).toBeGreaterThan(0);
    expect(report.topProducts.map((row: { name: string; qty: number }) => [row.name, row.qty])).toEqual([
      ['Capinha transparente', 3],
      ['Carregador 20W', 1],
    ]);
  });

  it('sem finance.view as taxas somem da resposta', async () => {
    const report = await analyst.get(`/api/reports/sales?${MONTH}`);
    expect(report.status).toBe(200);
    expect(report.body.totals.totalCents).toBe(18000);
    for (const row of report.body.byMethod) {
      expect(row).not.toHaveProperty('feeCents');
      expect(row).not.toHaveProperty('netCents');
    }
  });

  it('rejeita data inválida', async () => {
    const response = await owner.get('/api/reports/sales?period=range&from=2026-13-01');
    expect(response.status).toBe(400);
  });
});

describe('relatório de OS', () => {
  it('conta a primeira chegada em Pronto e o tempo médio por técnico', async () => {
    const report = await owner.get(`/api/reports/service-orders?${MONTH}`);
    expect(report.status).toBe(200);
    expect(report.body.totals).toEqual({ opened: 3, completed: 2, averageReadyMs: ((5 + 48) / 2) * 3600000 });
    const diegoRow = report.body.byTechnician.find((row: { name: string }) => row.name === 'Diego Ramos');
    expect(diegoRow).toMatchObject({ opened: 2, completed: 2, averageReadyMs: ((5 + 48) / 2) * 3600000 });
    const rafaelRow = report.body.byTechnician.find((row: { name: string }) => row.name === 'Rafael Lima');
    expect(rafaelRow).toMatchObject({ opened: 1, completed: 0, averageReadyMs: null });
  });

  it('a conclusão cai no dia em que a OS chegou em Pronto pela primeira vez', async () => {
    const report = await owner.get('/api/reports/service-orders?period=range&from=2026-11-14&to=2026-11-14');
    expect(report.body.totals.completed).toBe(0);
    const day15 = await owner.get('/api/reports/service-orders?period=range&from=2026-11-15&to=2026-11-15');
    expect(day15.body.totals.completed).toBe(1);
  });
});

describe('relatório financeiro', () => {
  it('custos e taxas batem com o resumo; fechamentos listam a diferença', async () => {
    const report = await owner.get(`/api/reports/finance?${MONTH}`);
    expect(report.status).toBe(200);
    const home = await owner.get(`/api/dashboard?${MONTH}`);
    expect(report.body.costs.totalCents).toBe(home.body.summary.expenseCents);
    expect(report.body.costs.byCategory).toHaveLength(1);
    expect(report.body.costs.byCategory[0].amountCents).toBe(2500);
    expect(report.body.fees.totalCents).toBe(home.body.summary.feeCents);
    expect(report.body.fees.totalCents).toBeGreaterThan(0);
    expect(report.body.closings).toHaveLength(1);
    expect(report.body.closings[0]).toMatchObject({ openedByName: 'Ana Souza', closedByName: 'Ana Souza', expectedCashCents: 12500, differenceCents: 0 });
  });

  it('perfil só com report.view não vê custos nem taxas', async () => {
    const report = await analyst.get(`/api/reports/finance?${MONTH}`);
    expect(report.status).toBe(200);
    expect(report.body.costs).toBeNull();
    expect(report.body.fees).toBeNull();
    expect(report.body.closings).toHaveLength(1);
  });
});

describe('desempenho da equipe', () => {
  it('vendas, ticket médio e OS concluídas por pessoa', async () => {
    const response = await owner.get(`/api/team/performance?${MONTH}`);
    expect(response.status).toBe(200);
    const row = (name: string) => response.body.items.find((entry: { name: string }) => entry.name === name);
    expect(row('Carlos Menezes')).toMatchObject({ salesCount: 2, salesTotalCents: 13000, averageTicketCents: 6500, completedOrders: 0 });
    expect(row('Ana Souza')).toMatchObject({ salesCount: 1, salesTotalCents: 5000, averageTicketCents: 5000 });
    expect(row('Diego Ramos')).toMatchObject({ salesCount: 0, completedOrders: 2 });
    expect(row('Rafael Lima')).toMatchObject({ completedOrders: 0 });
  });

  it('é só para quem gerencia a equipe', async () => {
    expect((await analyst.get(`/api/team/performance?${MONTH}`)).status).toBe(403);
  });
});

describe('auditoria', () => {
  it('filtra por período no fuso de São Paulo', async () => {
    const userId = t.base.users.get('admin')!;
    for (const createdAt of ['2026-11-10T02:59:00Z', '2026-11-10T03:00:00Z', '2026-11-11T02:30:00Z', '2026-11-11T03:00:00Z']) {
      await t.db.auditLog.create({ data: { userId, action: 'stock.adjusted', entity: 'PeriodProbe', createdAt: new Date(createdAt) } });
    }
    const audit = await owner.get('/api/audit?period=range&from=2026-11-10&to=2026-11-10&entity=PeriodProbe');
    expect(audit.status).toBe(200);
    expect(audit.body.total).toBe(2);
    expect(audit.body.items.map((row: { createdAt: string }) => row.createdAt)).toEqual(['2026-11-11T02:30:00.000Z', '2026-11-10T03:00:00.000Z']);
    expect(audit.body.items[0].userName).toBe('Carlos Menezes');
  });

  it('filtro de usuário lista também quem foi desativado', async () => {
    const livia = await t.db.user.findUniqueOrThrow({ where: { login: 'livia' } });
    await t.db.user.create({ data: { name: 'Otávio Reis', login: 'otavio', passwordHash: livia.passwordHash, roleId: livia.roleId, active: false } });
    const users = await owner.get('/api/audit/users');
    expect(users.status).toBe(200);
    expect(users.body.find((user: { name: string }) => user.name === 'Otávio Reis')).toMatchObject({ active: false });
    expect((await analyst.get('/api/audit/users')).status).toBe(403);
  });

  it('filtra por grupo de ação e pagina', async () => {
    const page = await owner.get('/api/audit?action=cash.&pageSize=1&page=2');
    expect(page.status).toBe(200);
    expect(page.body.total).toBeGreaterThanOrEqual(3);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.items[0].action.startsWith('cash.')).toBe(true);
  });
});
