import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProduct, item, setTestFees, setupTestApp, type Client, type TestApp } from './helpers.ts';

const FINANCE_FIELDS = ['feeCents', 'netCents', 'resultCents', 'feesCents', 'cmvCents', 'marginCents', 'feePercentBps', 'reversedFeeCents'];
const COST_FIELDS = ['costCents', 'unitCostCents', 'marginBps', 'marginCents', 'cmvCents'];

function keysDeep(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((entry) => keysDeep(entry, found));
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      found.add(key);
      keysDeep(entry, found);
    }
  }
  return found;
}

let t: TestApp;
let admin: Client;
let owner: Client;
let cashier: Client;
let technician: Client;

beforeAll(async () => {
  t = await setupTestApp();
  admin = await t.login('admin');
  owner = await t.login('admin');
  cashier = await t.login('ana');
  technician = await t.login('diego');
});

afterAll(async () => {
  await t.app.close();
});

describe('caixa fechado', () => {
  it('venda exige caixa aberto', async () => {
    const product = await createProduct(t.db, { name: 'Película 3D', priceCents: 5000 });
    const response = await cashier.post('/api/sales', { items: [item(product)], payments: [{ method: 'cash', amountCents: 5000 }] });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CASH_CLOSED');
    expect((await cashier.get('/api/cash/status')).body.session).toBeNull();
  });

  it('abre o caixa uma vez só', async () => {
    const opened = await cashier.post('/api/cash/open', { openingCents: 10000 });
    expect(opened.status).toBe(200);
    expect((await owner.post('/api/cash/open', { openingCents: 0 })).status).toBe(409);
    const status = await technician.get('/api/cash/status');
    expect(status.body.session.openedByName).toBe('Ana Souza');
  });
});

describe('cenários de venda', () => {
  it('A: crédito 3x de R$ 300,00 tem taxa R$ 14,97 e líquido R$ 285,03', async () => {
    const phone = await createProduct(t.db, { name: 'Fone Bluetooth', priceCents: 30000, costCents: 12000, stockQty: 3 });
    const response = await owner.post('/api/sales', {
      items: [item(phone)],
      payments: [{ method: 'credit', installments: 3, amountCents: 30000 }],
    });
    expect(response.status).toBe(200);
    const sale = response.body;
    expect(sale.number).toMatch(/^V-\d{6}$/);
    expect(sale.status).toBe('completed');
    expect(sale.feeCents).toBe(1497);
    expect(sale.netCents).toBe(28503);
    expect(sale.payments[0].amountCents).toBe(30000);
    expect((await t.db.product.findUniqueOrThrow({ where: { id: phone.id } })).stockQty).toBe(2);
  });

  it('B: Pix R$ 100 + dinheiro R$ 50 tem taxa R$ 0,99 e não fecha sem cobrir R$ 150', async () => {
    const charger = await createProduct(t.db, { name: 'Carregador turbo', priceCents: 15000, costCents: 6000 });
    const short = await owner.post('/api/sales', { items: [item(charger)], payments: [{ method: 'pix', amountCents: 10000 }] });
    expect(short.status).toBe(422);
    expect(short.body.error.code).toBe('PAYMENT_INCOMPLETE');
    expect(short.body.error.message).toContain('50,00');
    const response = await owner.post('/api/sales', {
      items: [item(charger)],
      payments: [
        { method: 'pix', amountCents: 10000 },
        { method: 'cash', amountCents: 5000 },
      ],
    });
    expect(response.status).toBe(200);
    expect(response.body.feeCents).toBe(99);
    expect(response.body.payments).toHaveLength(2);
  });

  it('C: R$ 100 em dinheiro numa venda de R$ 50 dá troco R$ 50 e entra R$ 50 na gaveta', async () => {
    const before = (await owner.get('/api/cash/current')).body.session.expectedNow.cash;
    const case_ = await createProduct(t.db, { name: 'Capinha silicone', priceCents: 5000, costCents: 2000 });
    const response = await cashier.post('/api/sales', { items: [item(case_)], payments: [{ method: 'cash', amountCents: 10000 }] });
    expect(response.status).toBe(200);
    expect(response.body.changeCents).toBe(5000);
    expect(response.body.payments[0].coveredCents).toBe(5000);
    expect(response.body.payments[0].amountCents).toBe(5000);
    const after = (await owner.get('/api/cash/current')).body.session.expectedNow.cash;
    expect(after - before).toBe(5000);
  });

  it('G: crédito 3x com repasse cobra R$ 315,76, taxa R$ 15,76 e líquido R$ 300,00', async () => {
    await setTestFees(t.db, { 'credit:3': { passToCustomer: true } });
    const watch = await createProduct(t.db, { name: 'Smartwatch', priceCents: 30000, costCents: 15000 });
    const response = await owner.post('/api/sales', {
      items: [item(watch)],
      payments: [{ method: 'credit', installments: 3, amountCents: 30000 }],
    });
    await setTestFees(t.db);
    expect(response.status).toBe(200);
    expect(response.body.totalCents).toBe(30000);
    expect(response.body.chargedCents).toBe(31576);
    expect(response.body.feeCents).toBe(1576);
    expect(response.body.netCents).toBe(30000);
    expect(response.body.payments[0].surchargeCents).toBe(1576);
  });

  it('pagamento acima do total só em dinheiro', async () => {
    const product = await createProduct(t.db, { name: 'Cabo USB-C', priceCents: 3000 });
    const response = await owner.post('/api/sales', { items: [item(product)], payments: [{ method: 'pix', amountCents: 5000 }] });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_PAYMENT');
  });

  it('não vende além do estoque disponível', async () => {
    const product = await createProduct(t.db, { name: 'Bateria externa', priceCents: 9000, stockQty: 1 });
    const response = await owner.post('/api/sales', {
      items: [item(product), item(product)],
      payments: [{ method: 'cash', amountCents: 18000 }],
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await t.db.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty).toBe(1);
  });

  it('item avulso entra sem mexer no estoque', async () => {
    const response = await cashier.post('/api/sales', {
      items: [{ name: 'Limpeza de conector', qty: 1, unitPriceCents: 2000 }],
      payments: [{ method: 'pix', amountCents: 2000 }],
    });
    expect(response.status).toBe(200);
    expect(response.body.items[0].productId).toBeNull();
  });
});

describe('aprovações', () => {
  it('desconto acima do limite do Caixa pede autorização e registra os dois usuários', async () => {
    const product = await createProduct(t.db, { name: 'Caixa de som', priceCents: 10000, costCents: 4000 });
    const body = {
      items: [item(product)],
      discount: { mode: 'percent', value: 1000 },
      payments: [{ method: 'cash', amountCents: 9000 }],
    };
    const denied = await cashier.post('/api/sales', body);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('APPROVAL_REQUIRED');
    const wrong = await cashier.post('/api/sales', { ...body, approval: { login: 'admin', password: 'errada' } });
    expect(wrong.body.error.code).toBe('APPROVAL_INVALID');
    const approved = await cashier.post('/api/sales', { ...body, approval: { login: 'admin', password: 'loja12345' } });
    expect(approved.status).toBe(200);
    expect(approved.body.totalCents).toBe(9000);
    const log = await t.db.auditLog.findFirstOrThrow({ where: { action: 'sale.discount_over_limit', entityId: approved.body.id } });
    const owner = await t.db.user.findFirstOrThrow({ where: { login: 'admin' } });
    const ana = await t.db.user.findFirstOrThrow({ where: { login: 'ana' } });
    expect(log.userId).toBe(ana.id);
    expect(log.approvedById).toBe(owner.id);
  });

  it('qualquer perfil com a permissão autoriza, não só o administrador', async () => {
    const role = await admin.post('/api/roles', { name: 'Supervisor', discountLimitBps: 1000, permissions: ['sale.create', 'sale.discount_over_limit'] });
    expect(role.status).toBe(200);
    expect((await admin.post('/api/users', { name: 'Marta Lopes', login: 'marta', email: 'marta@loja.test', roleId: role.body.id, temporaryPassword: 'temporaria1' })).status).toBe(200);
    const marta = await t.login('marta', 'temporaria1');
    expect((await marta.post('/api/auth/change-password', { currentPassword: 'temporaria1', newPassword: 'supervisora1' })).status).toBe(200);
    const product = await createProduct(t.db, { name: 'Fone sem fio', priceCents: 10000 });
    const body = { items: [item(product)], discount: { mode: 'percent', value: 1000 }, payments: [{ method: 'cash', amountCents: 9000 }] };
    const technician = await cashier.post('/api/sales', { ...body, approval: { login: 'diego', password: 'loja12345' } });
    expect(technician.body.error.code).toBe('APPROVAL_INVALID');
    const approved = await cashier.post('/api/sales', { ...body, approval: { login: 'marta', password: 'supervisora1' } });
    expect(approved.status).toBe(200);
    const log = await t.db.auditLog.findFirstOrThrow({ where: { action: 'sale.discount_over_limit', entityId: approved.body.id } });
    expect(log.approvedById).toBe((await t.db.user.findFirstOrThrow({ where: { login: 'marta' } })).id);
  });

  it('desconto dentro do limite não pede aprovação', async () => {
    const product = await createProduct(t.db, { name: 'Suporte veicular', priceCents: 10000 });
    const response = await cashier.post('/api/sales', {
      items: [item(product)],
      discount: { mode: 'amount', value: 500 },
      payments: [{ method: 'cash', amountCents: 9500 }],
    });
    expect(response.status).toBe(200);
  });

  it('alterar preço de item do catálogo pede aprovação (aceita o e-mail de quem autoriza) e fica no log', async () => {
    const product = await createProduct(t.db, { name: 'Película de vidro', priceCents: 4000 });
    const body = { items: [{ ...item(product), unitPriceCents: 3000 }], payments: [{ method: 'cash', amountCents: 3000 }] };
    expect((await cashier.post('/api/sales', body)).body.error.code).toBe('APPROVAL_REQUIRED');
    const approved = await cashier.post('/api/sales', { ...body, approval: { login: 'Carlos@loja.test', password: 'loja12345' } });
    expect(approved.status).toBe(200);
    expect(await t.db.auditLog.count({ where: { action: 'sale.price_override', entityId: approved.body.id, approvedById: t.base.users.get('admin') } })).toBe(1);
  });

  it('saldo pendente exige cliente e permissão', async () => {
    const product = await createProduct(t.db, { name: 'Tablet 8"', priceCents: 80000, costCents: 50000 });
    const customer = await t.db.customer.findFirstOrThrow({ where: { anonymizedAt: null } });
    const body = { items: [item(product)], payments: [{ method: 'pix', amountCents: 30000 }], allowPending: true };
    const noCustomer = await owner.post('/api/sales', body);
    expect(noCustomer.status).toBe(400);
    expect(noCustomer.body.error.details.issues[0].path).toBe('customerId');
    const denied = await cashier.post('/api/sales', { ...body, customerId: customer.id });
    expect(denied.body.error.code).toBe('APPROVAL_REQUIRED');
    const response = await owner.post('/api/sales', { ...body, customerId: customer.id });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('pending');
    expect(response.body.balanceCents).toBe(50000);
    const partial = await cashier.post(`/api/sales/${response.body.id}/payments`, { payments: [{ method: 'cash', amountCents: 20000 }] });
    expect(partial.status).toBe(200);
    expect(partial.body.status).toBe('pending');
    expect((await cashier.get(`/api/sales/${response.body.id}`)).status).toBe(404);
    const received = await owner.post(`/api/sales/${response.body.id}/payments`, { payments: [{ method: 'cash', amountCents: 30000 }] });
    expect(received.status).toBe(200);
    expect(received.body.status).toBe('completed');
    expect(received.body.balanceCents).toBe(0);
  });
});

describe('orçamentos', () => {
  it('salva orçamento sem caixa, com validade, e converte em venda conferindo preço', async () => {
    const product = await createProduct(t.db, { name: 'Fone com fio', priceCents: 6000, costCents: 2500, stockQty: 4 });
    const quote = await cashier.post('/api/quotes', { items: [item(product, 2)] });
    expect(quote.status).toBe(200);
    expect(quote.body.quoteNumber).toMatch(/^ORC-\d{6}$/);
    expect(quote.body.status).toBe('quote');
    expect(new Date(quote.body.quoteValidUntil).getTime() - new Date(quote.body.quoteCreatedAt).getTime()).toBe(7 * 86400000);
    expect((await t.db.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty).toBe(4);
    const listed = await cashier.get('/api/quotes');
    expect(listed.body.items.some((row: { id: string }) => row.id === quote.body.id)).toBe(true);

    await t.db.product.update({ where: { id: product.id }, data: { priceCents: 6500 } });
    const stale = await cashier.post('/api/sales', {
      quoteId: quote.body.id,
      items: quote.body.items.map((row: { productId: string; name: string; qty: number; unitPriceCents: number }) => ({
        productId: row.productId,
        name: row.name,
        qty: row.qty,
        unitPriceCents: row.unitPriceCents,
      })),
      payments: [{ method: 'cash', amountCents: 12000 }],
    });
    expect(stale.body.error.code).toBe('APPROVAL_REQUIRED');
    const converted = await cashier.post('/api/sales', {
      quoteId: quote.body.id,
      items: [item({ ...product, priceCents: 6500 }, 2)],
      payments: [{ method: 'cash', amountCents: 13000 }],
    });
    expect(converted.status).toBe(200);
    expect(converted.body.id).toBe(quote.body.id);
    expect(converted.body.number).toMatch(/^V-/);
    expect(converted.body.quoteNumber).toBe(quote.body.quoteNumber);
    expect(converted.body.totalCents).toBe(13000);
    expect((await t.db.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty).toBe(2);
    const again = await cashier.post('/api/sales', { quoteId: quote.body.id, items: [item({ ...product, priceCents: 6500 })], payments: [{ method: 'cash', amountCents: 6500 }] });
    expect(again.status).toBe(409);
  });

  it('lista orçamentos com status e não mostra orçamento cancelado no histórico de vendas', async () => {
    const product = await createProduct(t.db, { name: 'Capa de couro', priceCents: 8000, stockQty: 5 });
    const open = await cashier.post('/api/quotes', { items: [item(product)] });
    const dropped = await cashier.post('/api/quotes', { items: [item(product)], validityDays: 1 });
    const cancelled = await owner.post(`/api/sales/${dropped.body.id}/cancel`, { reason: 'Cliente não voltou' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');

    const statusOf = async (id: string) => ((await cashier.get('/api/quotes')).body.items as { id: string; status: string }[]).find((row) => row.id === id)?.status;
    expect(await statusOf(open.body.id)).toBe('open');
    expect(await statusOf(dropped.body.id)).toBe('cancelled');
    const converted = (await cashier.get('/api/quotes?status=converted')).body.items as { status: string; saleNumber: string }[];
    expect(converted.length).toBeGreaterThan(0);
    expect(converted.every((row) => row.status === 'converted' && /^V-/.test(row.saleNumber))).toBe(true);
    const onlyCancelled = (await cashier.get('/api/quotes?status=cancelled')).body.items as { id: string }[];
    expect(onlyCancelled.map((row) => row.id)).toContain(dropped.body.id);
    expect(onlyCancelled.map((row) => row.id)).not.toContain(open.body.id);

    const expiring = await cashier.post('/api/quotes', { items: [item(product)], validityDays: 1 });
    await t.db.sale.update({ where: { id: expiring.body.id }, data: { quoteValidUntil: new Date(t.clock.now().getTime() - 60000) } });
    expect(await statusOf(expiring.body.id)).toBe('expired');
    const late = await cashier.post('/api/sales', { quoteId: expiring.body.id, items: [item(product)], payments: [{ method: 'cash', amountCents: 8000 }] });
    expect(late.status).toBe(409);

    const sales = (await owner.get('/api/sales?pageSize=200')).body.items as { id: string }[];
    expect(sales.map((row) => row.id)).not.toContain(dropped.body.id);
    expect(sales.map((row) => row.id)).not.toContain(open.body.id);
  });
});

describe('I: permissões e campos escondidos', () => {
  it('técnico recebe 403 ao cancelar venda', async () => {
    const sale = await t.db.sale.findFirstOrThrow({ where: { status: 'completed' } });
    const response = await technician.post(`/api/sales/${sale.id}/cancel`, { reason: 'Teste de permissão' });
    expect(response.status).toBe(403);
    expect((await t.db.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe('completed');
  });

  it('Caixa não recebe custo, taxa nem resultado na Home, na venda e no detalhe', async () => {
    const home = await cashier.get('/api/dashboard');
    expect(home.status).toBe(200);
    expect(home.body.mode).toBe('reduced');
    const product = await createProduct(t.db, { name: 'Pop socket', priceCents: 2500, costCents: 800 });
    const created = await cashier.post('/api/sales', { items: [item(product)], payments: [{ method: 'credit', installments: 1, amountCents: 2500 }] });
    expect(created.status).toBe(200);
    const detail = await cashier.get(`/api/sales/${created.body.id}`);
    const lookup = await cashier.get(`/api/products/${product.id}`);
    for (const [label, body] of [['home', home.body], ['venda', created.body], ['detalhe', detail.body], ['produto', lookup.body]] as const) {
      const keys = keysDeep(body);
      for (const field of [...FINANCE_FIELDS, ...COST_FIELDS]) expect(keys.has(field), `${label}: ${field}`).toBe(false);
    }
    expect((await owner.get(`/api/sales/${created.body.id}`)).body.feeCents).toBe(87);
  });

  it('Caixa só vê as próprias vendas', async () => {
    const own = await cashier.get('/api/sales');
    const ana = await t.db.user.findFirstOrThrow({ where: { login: 'ana' } });
    const all = await t.db.sale.findMany({ where: { status: { not: 'quote' }, number: { not: null } } });
    expect(own.body.items.length).toBe(all.filter((sale) => sale.sellerId === ana.id).length);
    const other = all.find((sale) => sale.sellerId !== ana.id)!;
    expect((await cashier.get(`/api/sales/${other.id}`)).status).toBe(404);
    expect((await admin.get('/api/sales')).body.total).toBe(all.length);
  });

  it('totais do histórico respeitam o filtro de situação e ignoram canceladas', async () => {
    const product = await createProduct(t.db, { name: 'Smartwatch', priceCents: 40000, costCents: 25000 });
    const customer = await t.db.customer.findFirstOrThrow({ where: { anonymizedAt: null } });
    const created = await owner.post('/api/sales', { items: [item(product)], payments: [{ method: 'pix', amountCents: 10000 }], allowPending: true, customerId: customer.id });
    expect(created.body.status).toBe('pending');
    const all = await t.db.sale.findMany({ where: { status: { not: 'quote' }, number: { not: null } } });
    const sumOf = (status: string[]) => {
      const rows = all.filter((sale) => status.includes(sale.status));
      return { validCount: rows.length, totalCents: rows.reduce((sum, sale) => sum + sale.totalCents, 0) };
    };
    const pending = (await admin.get('/api/sales?status=pending&pageSize=200')).body;
    expect(pending.items.length).toBeGreaterThan(0);
    expect({ validCount: pending.validCount, totalCents: pending.totalCents }).toEqual(sumOf(['pending']));
    const everything = (await admin.get('/api/sales?pageSize=200')).body;
    expect({ validCount: everything.validCount, totalCents: everything.totalCents }).toEqual(sumOf(['completed', 'pending']));
    const cancelled = (await admin.get('/api/sales?status=cancelled&pageSize=200')).body;
    expect({ validCount: cancelled.validCount, totalCents: cancelled.totalCents }).toEqual({ validCount: 0, totalCents: 0 });
    const settled = await owner.post(`/api/sales/${created.body.id}/payments`, { payments: [{ method: 'cash', amountCents: 30000 }] });
    expect(settled.body.status).toBe('completed');
  });

  it('Home completa para quem vê o financeiro', async () => {
    const home = await owner.get('/api/dashboard?period=today');
    expect(home.status).toBe(200);
    expect(home.body.mode).toBe('full');
    expect(home.body.summary.salesCount).toBeGreaterThan(0);
    expect(home.body.chart.granularity).toBe('hour');
    expect(home.body.chart.points).toHaveLength(24);
    expect(home.body.receivables.totalCents).toBe(0);
    const month = await owner.get('/api/dashboard?period=month');
    expect(month.body.chart.granularity).toBe('day');
    expect((await owner.get('/api/dashboard?period=range&from=2026-13-01')).status).toBe(400);
  });
});

describe('exportação do histórico e itens vendidos', () => {
  let discountedId: string;
  let cancelledId: string;

  beforeAll(async () => {
    const cable = await createProduct(t.db, { name: 'Cabo USB-C', priceCents: 4000, costCents: 1000, stockQty: 20 });
    const film = await createProduct(t.db, { name: 'Película 3D', priceCents: 3000, costCents: 500, stockQty: 20 });
    const discounted = await owner.post('/api/sales', {
      items: [{ ...item(cable, 2), discount: { mode: 'amount', value: 1000 } }, item(film)],
      discount: { mode: 'amount', value: 500 },
      payments: [{ method: 'pix', amountCents: 9500 }],
    });
    expect(discounted.status, JSON.stringify(discounted.body)).toBe(200);
    discountedId = discounted.body.id;
    const dropped = await owner.post('/api/sales', { items: [item(film, 3)], payments: [{ method: 'cash', amountCents: 9000 }] });
    expect(dropped.status, JSON.stringify(dropped.body)).toBe(200);
    cancelledId = dropped.body.id;
    expect((await owner.post(`/api/sales/${cancelledId}/cancel`, { reason: 'Cliente desistiu' })).status).toBe(200);
  });

  it('exporta todas as vendas do filtro, não só a página', async () => {
    const page = (await admin.get('/api/sales?period=month&pageSize=1')).body;
    expect(page.total).toBeGreaterThan(1);
    const exported = await admin.get('/api/sales/export?period=month');
    expect(exported.status).toBe(200);
    expect(exported.body.items).toHaveLength(page.total);
    expect(exported.body.period).toMatchObject({ kind: 'month', start: expect.any(String), end: expect.any(String) });
    const listed = (await admin.get('/api/sales?period=month&pageSize=200')).body.items.map((row: { id: string }) => row.id);
    expect(exported.body.items.map((row: { id: string }) => row.id)).toEqual(listed);

    const cancelled = (await admin.get('/api/sales/export?period=month&status=cancelled')).body.items;
    expect(cancelled.map((row: { id: string }) => row.id)).toContain(cancelledId);
    expect(cancelled.every((row: { status: string }) => row.status === 'cancelled')).toBe(true);

    const sale = exported.body.items.find((row: { id: string }) => row.id === discountedId);
    expect(sale).toMatchObject({ totalCents: 9500, discountCents: 1500, sellerName: 'Carlos Menezes', methods: ['pix'] });
    expect(sale.items).toEqual([
      { name: 'Cabo USB-C', qty: 2 },
      { name: 'Película 3D', qty: 1 },
    ]);
  });

  it('Caixa exporta só as próprias vendas, mesmo pedindo outro vendedor', async () => {
    const carlos = await t.db.user.findFirstOrThrow({ where: { login: 'admin' } });
    const own = (await cashier.get('/api/sales?period=month')).body;
    const exported = (await cashier.get(`/api/sales/export?period=month&sellerId=${carlos.id}`)).body.items;
    expect(exported).toHaveLength(own.total);
    expect(exported.length).toBeGreaterThan(0);
    expect(exported.every((row: { sellerName: string }) => row.sellerName === 'Ana Souza')).toBe(true);
    expect((await technician.get('/api/sales/export')).status).toBe(403);
  });

  it('itens vendidos: uma linha por item, sem canceladas, batendo com Mais vendidos', async () => {
    const report = await owner.get('/api/reports/sale-items?period=month');
    expect(report.status).toBe(200);
    const rows = report.body.items as { saleId: string; productId: string | null; name: string; qty: number; unitPriceCents: number; discountCents: number; totalCents: number; sellerName: string }[];
    expect(rows.some((row) => row.saleId === cancelledId)).toBe(false);

    const valid = await t.db.saleItem.count({ where: { sale: { status: { in: ['completed', 'pending'] }, completedAt: { not: null } } } });
    expect(rows).toHaveLength(valid);

    const discounted = rows.filter((row) => row.saleId === discountedId);
    expect(discounted.map((row) => [row.name, row.qty, row.unitPriceCents, row.discountCents, row.totalCents, row.sellerName])).toEqual([
      ['Cabo USB-C', 2, 4000, 1000, 7000, 'Carlos Menezes'],
      ['Película 3D', 1, 3000, 0, 3000, 'Carlos Menezes'],
    ]);

    const top = (await owner.get('/api/reports/sales?period=month')).body.topProducts as { productId: string | null; name: string; qty: number; totalCents: number }[];
    const grouped = new Map<string, { qty: number; totalCents: number }>();
    for (const row of rows) {
      const key = row.productId ?? `free:${row.name.trim().toLowerCase()}`;
      const entry = grouped.get(key) ?? { qty: 0, totalCents: 0 };
      grouped.set(key, { qty: entry.qty + row.qty, totalCents: entry.totalCents + row.totalCents });
    }
    expect(grouped.size).toBe(top.length);
    for (const product of top) expect(grouped.get(product.productId ?? `free:${product.name.trim().toLowerCase()}`)).toEqual({ qty: product.qty, totalCents: product.totalCents });

    expect((await cashier.get('/api/reports/sale-items')).status).toBe(403);
  });
});
