import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createProduct, PASSWORD, setupTestApp, tableCounts, type Client, type TestApp } from './helpers.ts';

let t: TestApp;
let owner: Client;
let cashier: Client;
let diego: Client;
let rafael: Client;
let customerId: string;

const APPROVAL = { login: 'admin', password: PASSWORD };

async function loginAll() {
  owner = await t.login('admin');
  cashier = await t.login('ana');
  diego = await t.login('diego');
  rafael = await t.login('rafael');
}

function column(name: string) {
  const id = t.base.columns.get(name);
  if (!id) throw new Error(`Coluna ${name} não existe no seed`);
  return id;
}

async function newOrder(client: Client, overrides: Record<string, unknown> = {}) {
  const response = await client.post('/api/service-orders', {
    customerId,
    deviceType: 'Celular',
    brand: 'Samsung',
    model: 'Galaxy A54',
    reportedIssue: 'Tela quebrada após queda',
    ...overrides,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body;
}

async function quote(client: Client, id: string, items: unknown[], discountCents = 0, extra: Record<string, unknown> = {}) {
  return client.put(`/api/service-orders/${id}/items`, { items, discountCents, ...extra });
}

async function moveTo(client: Client, id: string, name: string, position = 0, extra: Record<string, unknown> = {}) {
  return client.post(`/api/service-orders/${id}/move`, { columnId: column(name), position, ...extra });
}

async function makeReady(id: string, items: unknown[], discountCents = 0) {
  expect((await quote(owner, id, items, discountCents)).status).toBe(200);
  expect((await owner.put(`/api/service-orders/${id}`, { diagnosis: 'Display danificado, troca necessária.' })).status).toBe(200);
  const moved = await moveTo(owner, id, 'Pronto para retirada');
  expect(moved.status, JSON.stringify(moved.body)).toBe(200);
  return moved.body;
}

function labor(cents: number, name = 'Mão de obra') {
  return { productId: null, kind: 'labor', name, qty: 1, unitPriceCents: cents };
}

function part(product: { id: string; name: string }, cents: number, qty = 1) {
  return { productId: product.id, kind: 'part', name: product.name, qty, unitPriceCents: cents };
}

async function summary(client: Client) {
  return (await client.get('/api/dashboard?period=today')).body.summary;
}

beforeAll(async () => {
  t = await setupTestApp({ now: '2026-11-24T13:00:00Z' });
  await loginAll();
  const customer = await t.db.customer.create({ data: { name: 'Marina Albuquerque', phoneE164: '+5511987654321' } });
  customerId = customer.id;
  expect((await cashier.post('/api/cash/open', { openingCents: 10000 })).status).toBe(200);
});

afterEach(() => {
  t.deps.failpoints.clear();
});

afterAll(async () => {
  await t.app.close();
});

describe('E: OS do início ao fim', () => {
  it('sinal no dia 1 e Receber e entregar no dia 2 batem com o resultado esperado', async () => {
    const display = await createProduct(t.db, { name: 'Display Galaxy A54', priceCents: 15000, costCents: 8000, stockQty: 3 });
    const os = await newOrder(owner, { technicianId: t.base.users.get('diego') });
    expect(os.number).toMatch(/^OS/);
    expect(os.column.name).toBe('Recebido');
    expect(os.warrantyDays).toBe(90);

    const quoted = await quote(diego, os.id, [part(display, 15000), labor(10000)]);
    expect(quoted.status, JSON.stringify(quoted.body)).toBe(200);
    expect(quoted.body.totalCents).toBe(25000);

    const before = await summary(owner);
    const deposit = await cashier.post(`/api/service-orders/${os.id}/deposit`, { payments: [{ method: 'pix', amountCents: 5000 }] });
    expect(deposit.status, JSON.stringify(deposit.body)).toBe(200);
    expect(deposit.body.depositCents).toBe(5000);
    expect(deposit.body.balanceCents).toBe(20000);
    const dayOne = await summary(owner);
    expect(dayOne.receivedCents - before.receivedCents).toBe(5000);
    expect(dayOne.feeCents - before.feeCents).toBe(50);
    expect(dayOne.resultCents - before.resultCents).toBe(4950);

    expect((await owner.post(`/api/service-orders/${os.id}/approval`, { decision: 'approved', by: 'Marina', channel: 'whatsapp' })).status).toBe(200);
    expect((await moveTo(diego, os.id, 'Em conserto')).status).toBe(200);
    expect((await diego.put(`/api/service-orders/${os.id}`, { diagnosis: 'Display trincado, troca feita.' })).status).toBe(200);
    expect((await moveTo(diego, os.id, 'Pronto para retirada')).status).toBe(200);

    const expected = (await cashier.get('/api/cash/current')).body.session.expectedNow.cash;
    expect((await cashier.post('/api/cash/close', { countedCashCents: expected })).status).toBe(200);
    t.clock.set('2026-11-25T13:00:00Z');
    await loginAll();
    expect((await cashier.post('/api/cash/open', { openingCents: 10000 })).status).toBe(200);

    const dayTwoBefore = await summary(owner);
    const delivered = await cashier.post(`/api/service-orders/${os.id}/deliver`, { payments: [{ method: 'credit', installments: 2, amountCents: 20000 }] });
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
    expect(delivered.body.column.name).toBe('Entregue');
    expect(delivered.body.delivery).toMatchObject({ status: 'completed', totalCents: 25000, paidCents: 25000, pendingCents: 0 });
    expect(delivered.body.deliveredAt).toBe('2026-11-25T13:00:00.000Z');
    expect(new Date(delivered.body.warrantyUntil).getTime()).toBeGreaterThan(new Date('2027-02-22T00:00:00Z').getTime());

    const sale = await t.db.sale.findUniqueOrThrow({ where: { serviceOrderId: os.id }, include: { items: true, payments: true } });
    expect(sale.origin).toBe('os');
    expect(sale.totalCents).toBe(25000);
    expect(sale.costCents).toBe(8000);
    expect(sale.items).toHaveLength(2);
    expect(sale.payments).toHaveLength(2);
    const credit = sale.payments.find((payment) => payment.method === 'credit')!;
    expect(credit.feeCents).toBe(898);
    expect((await t.db.product.findUniqueOrThrow({ where: { id: display.id } })).stockQty).toBe(2);
    const movement = await t.db.stockMovement.findFirstOrThrow({ where: { productId: display.id, type: 'os_use' } });
    expect(movement).toMatchObject({ qty: -1, refType: 'ServiceOrder', refNumber: os.number });

    const dayTwo = await summary(owner);
    expect(dayTwo.receivedCents - dayTwoBefore.receivedCents).toBe(20000);
    expect(dayTwo.feeCents - dayTwoBefore.feeCents).toBe(898);
    expect(dayTwo.cmvCents - dayTwoBefore.cmvCents).toBe(8000);
    expect(dayTwo.resultCents - dayTwoBefore.resultCents).toBe(11102);

    expect((await cashier.post(`/api/service-orders/${os.id}/deliver`, { payments: [] })).status).toBe(409);
    expect((await moveTo(owner, os.id, 'Em análise')).status).toBe(409);
    expect((await owner.put(`/api/service-orders/${os.id}`, { brand: 'Outra' })).status).toBe(409);
    const types = delivered.body.events.map((event: { type: string }) => event.type);
    expect(types).toEqual(expect.arrayContaining(['created', 'quote_updated', 'payment', 'approved', 'moved', 'delivered']));
  });
});

describe('H: entregar com saldo a receber', () => {
  it('dono entrega recebendo 100 de 250; caixa não pode deixar saldo', async () => {
    const os = await newOrder(owner);
    await makeReady(os.id, [labor(25000, 'Troca de conector')]);
    const partial = { payments: [{ method: 'cash', amountCents: 10000 }] };
    const incomplete = await cashier.post(`/api/service-orders/${os.id}/deliver`, partial);
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.code).toBe('PAYMENT_INCOMPLETE');
    const denied = await cashier.post(`/api/service-orders/${os.id}/deliver`, { ...partial, allowPending: true });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('APPROVAL_REQUIRED');
    expect(await t.db.sale.count({ where: { serviceOrderId: os.id } })).toBe(0);

    const delivered = await owner.post(`/api/service-orders/${os.id}/deliver`, { ...partial, allowPending: true });
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
    expect(delivered.body.delivery).toMatchObject({ status: 'pending', totalCents: 25000, paidCents: 10000, pendingCents: 15000 });
    expect(delivered.body.balanceCents).toBe(15000);
    const receivables = (await owner.get('/api/dashboard?period=today')).body.receivables;
    const entry = receivables.items.find((row: { number: string }) => row.number === delivered.body.delivery.saleNumber);
    expect(entry).toMatchObject({ kind: 'sale', balanceCents: 15000 });

    const list = (await cashier.get('/api/receivables')).body;
    expect(list.items.some((row: { number: string }) => row.number === delivered.body.delivery.saleNumber)).toBe(true);
    expect((await diego.get('/api/receivables')).status).toBe(403);
    const sale = await t.db.sale.findUniqueOrThrow({ where: { serviceOrderId: os.id } });
    const rest = await cashier.post(`/api/sales/${sale.id}/payments`, { payments: [{ method: 'pix', amountCents: 15000 }] });
    expect(rest.status).toBe(200);
    expect(rest.body.status).toBe('completed');
  });

  it('caixa entrega com saldo quando o dono autoriza', async () => {
    const os = await newOrder(owner);
    await makeReady(os.id, [labor(8000)]);
    const delivered = await cashier.post(`/api/service-orders/${os.id}/deliver`, {
      payments: [{ method: 'pix', amountCents: 3000 }],
      allowPending: true,
      approval: APPROVAL,
    });
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
    const sale = await t.db.sale.findUniqueOrThrow({ where: { serviceOrderId: os.id } });
    expect(sale.status).toBe('pending');
    expect(sale.approvedById).toBe(t.base.users.get('admin'));
  });
});

describe('J: aviso de pronto pelo WhatsApp', () => {
  it('mover para Pronto devolve a coluna com aviso automático e o registro entra na linha do tempo', async () => {
    const os = await newOrder(owner);
    expect((await quote(owner, os.id, [labor(12000)])).status).toBe(200);
    const blocked = await moveTo(owner, os.id, 'Pronto para retirada');
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('REQUIRED_FIELDS');
    expect(blocked.body.error.message).toContain('diagnóstico');
    const moved = await makeReady(os.id, [labor(12000)]);
    expect(moved.moved).toBe(true);
    expect(moved.column).toMatchObject({ name: 'Pronto para retirada', whatsappEnabled: true, whatsappTrigger: 'on_move' });
    expect(moved.column.template.body).toContain('{aparelho}');
    expect(moved.customer.phoneE164).toBe('+5511987654321');

    expect((await owner.post(`/api/service-orders/${os.id}/whatsapp`, { context: 'move' })).status).toBe(200);
    const detail = (await owner.get(`/api/service-orders/${os.id}`)).body;
    const logged = detail.events.find((event: { type: string }) => event.type === 'whatsapp_opened');
    expect(logged.data).toMatchObject({ context: 'move', columnId: column('Pronto para retirada') });
    expect(logged.userName).toBe('Carlos Menezes');
  });
});

describe('regras do quadro', () => {
  it('campos obrigatórios, coluna de entregue e reordenação', async () => {
    const os = await newOrder(owner);
    const missing = await moveTo(owner, os.id, 'Em conserto');
    expect(missing.status).toBe(422);
    expect(missing.body.error.details.missing).toEqual(['approval']);
    expect((await moveTo(owner, os.id, 'Entregue')).status).toBe(409);
    const second = await newOrder(owner);
    const reordered = await moveTo(owner, second.id, 'Recebido', 0);
    expect(reordered.status).toBe(200);
    expect(reordered.body.moved).toBe(false);
    const board = (await owner.get('/api/service-orders/board')).body;
    const received = board.columns.find((col: { name: string }) => col.name === 'Recebido');
    const ids = received.cards.map((card: { id: string }) => card.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(os.id));
    const third = await newOrder(owner);
    const afterSecond = await owner.post(`/api/service-orders/${third.id}/move`, { columnId: received.id, afterId: second.id });
    expect(afterSecond.status).toBe(200);
    const top = await owner.post(`/api/service-orders/${os.id}/move`, { columnId: received.id, afterId: null });
    expect(top.status).toBe(200);
    const reread = (await owner.get('/api/service-orders/board')).body.columns.find((col: { name: string }) => col.name === 'Recebido');
    expect(reread.cards.map((card: { id: string }) => card.id)).toEqual([os.id, second.id, third.id]);
    expect(received.sumCents).not.toBeNull();
    expect((await cashier.get('/api/service-orders/board')).body.columns[0].sumCents).toBeNull();
  });

  it('previsão vencida só deixa a OS atrasada até ela ficar pronta', async () => {
    const os = await newOrder(owner, { dueAt: '2026-11-23T21:00:00Z' });
    const lateIds = async () => {
      const board = (await owner.get('/api/service-orders/board?late=1')).body;
      return board.columns.flatMap((col: { cards: { id: string }[] }) => col.cards.map((card) => card.id));
    };
    const lateCount = async () => (await owner.get('/api/dashboard?period=today')).body.serviceOrders.lateCount;
    expect((await owner.get(`/api/service-orders/${os.id}`)).body.flags.late).toBe(true);
    expect(await lateIds()).toContain(os.id);
    const before = await lateCount();
    const ready = await makeReady(os.id, [labor(10000)]);
    expect(ready.flags.late).toBe(false);
    expect(await lateIds()).not.toContain(os.id);
    expect(await lateCount()).toBe(before - 1);
  });

  it('técnico só vê OS dele ou sem técnico', async () => {
    const mine = await newOrder(owner, { technicianId: t.base.users.get('diego') });
    const other = await newOrder(owner, { technicianId: t.base.users.get('rafael') });
    const free = await newOrder(owner);
    expect((await diego.get(`/api/service-orders/${mine.id}`)).status).toBe(200);
    expect((await diego.get(`/api/service-orders/${free.id}`)).status).toBe(200);
    expect((await diego.get(`/api/service-orders/${other.id}`)).status).toBe(404);
    expect((await diego.post(`/api/service-orders/${other.id}/move`, { columnId: column('Em análise'), position: 0 })).status).toBe(404);
    expect((await rafael.get(`/api/service-orders/${other.id}`)).status).toBe(200);
    const board = (await diego.get('/api/service-orders/board')).body;
    const visible = board.columns.flatMap((col: { cards: { id: string }[] }) => col.cards.map((card) => card.id));
    expect(visible).toContain(mine.id);
    expect(visible).toContain(free.id);
    expect(visible).not.toContain(other.id);
    expect(board.columns.some((col: { sumCents: number | null }) => col.sumCents !== null)).toBe(false);
  });

  it('senha de desbloqueio fica cifrada e só aparece com permissão, com registro', async () => {
    const os = await newOrder(owner, { unlockType: 'pin', unlockSecret: '4821' });
    expect(os.hasSecret).toBe(true);
    expect(os).not.toHaveProperty('unlockSecretEnc');
    const stored = await t.db.serviceOrder.findUniqueOrThrow({ where: { id: os.id } });
    expect(stored.unlockSecretEnc).not.toContain('4821');
    expect((await cashier.post(`/api/service-orders/${os.id}/secret`)).status).toBe(403);
    const shown = await diego.post(`/api/service-orders/${os.id}/secret`);
    expect(shown.body).toEqual({ unlockType: 'pin', secret: '4821' });
    expect(await t.db.auditLog.count({ where: { action: 'os.secret_viewed', entityId: os.id } })).toBe(1);
    await t.db.serviceOrder.update({ where: { id: os.id }, data: { checklist: { 'Liga normalmente': true } } });
    expect((await owner.put(`/api/service-orders/${os.id}`, { diagnosis: 'Conector oxidado' })).status).toBe(200);
    const partial = await t.db.serviceOrder.findUniqueOrThrow({ where: { id: os.id } });
    expect(partial.unlockType).toBe('pin');
    expect(partial.unlockSecretEnc).toBe(stored.unlockSecretEnc);
    expect(partial.checklist).toEqual({ 'Liga normalmente': true });
    expect((await owner.put(`/api/service-orders/${os.id}`, { unlockType: 'none' })).status).toBe(200);
    expect((await t.db.serviceOrder.findUniqueOrThrow({ where: { id: os.id } })).unlockSecretEnc).toBeNull();
  });
});

describe('orçamento, sinal e recusa', () => {
  it('desconto acima do limite pede autorização e a venda sai com o total cobrado', async () => {
    const os = await newOrder(owner, { technicianId: t.base.users.get('diego') });
    const items = [labor(20000)];
    const denied = await quote(diego, os.id, items, 1000);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('APPROVAL_REQUIRED');
    const approved = await quote(diego, os.id, items, 1000, { approval: APPROVAL });
    expect(approved.status).toBe(200);
    expect(approved.body.totalCents).toBe(19000);
    expect(await t.db.auditLog.count({ where: { action: 'os.discount_over_limit', entityId: os.id } })).toBe(1);
    expect((await owner.put(`/api/service-orders/${os.id}`, { diagnosis: 'Troca de bateria.' })).status).toBe(200);
    expect((await moveTo(owner, os.id, 'Pronto para retirada')).status).toBe(200);
    const delivered = await cashier.post(`/api/service-orders/${os.id}/deliver`, { payments: [{ method: 'cash', amountCents: 19000 }] });
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
    const sale = await t.db.sale.findUniqueOrThrow({ where: { serviceOrderId: os.id } });
    expect(sale).toMatchObject({ subtotalCents: 20000, discountCents: 1000, totalCents: 19000, paidCents: 19000, status: 'completed' });
  });

  it('sinal exige orçamento e não passa do saldo; orçamento não fica abaixo do sinal', async () => {
    const os = await newOrder(owner);
    const early = await cashier.post(`/api/service-orders/${os.id}/deposit`, { payments: [{ method: 'pix', amountCents: 1000 }] });
    expect(early.status).toBe(422);
    expect((await quote(owner, os.id, [labor(10000)])).status).toBe(200);
    expect((await cashier.post(`/api/service-orders/${os.id}/deposit`, { payments: [{ method: 'pix', amountCents: 12000 }] })).status).toBe(422);
    expect((await cashier.post(`/api/service-orders/${os.id}/deposit`, { payments: [{ method: 'pix', amountCents: 6000 }] })).status).toBe(200);
    expect((await quote(owner, os.id, [labor(5000)])).status).toBe(409);
    expect((await diego.post(`/api/service-orders/${os.id}/deposit`, { payments: [{ method: 'pix', amountCents: 1000 }] })).status).toBe(403);
  });

  it('recusa com taxa vai para Pronto e cobra só a taxa, sem garantia nem baixa de peça', async () => {
    const screen = await createProduct(t.db, { name: 'Tela iPhone 12', priceCents: 60000, costCents: 30000, stockQty: 1 });
    const os = await newOrder(owner, { brand: 'Apple', model: 'iPhone 12' });
    expect((await quote(owner, os.id, [part(screen, 60000), labor(15000)])).status).toBe(200);
    const rejected = await owner.post(`/api/service-orders/${os.id}/approval`, { decision: 'rejected', by: 'Marina', channel: 'telefone', diagnosisFeeCents: 4000 });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect(rejected.body.column.name).toBe('Pronto para retirada');
    expect(rejected.body.totalCents).toBe(4000);
    const delivered = await cashier.post(`/api/service-orders/${os.id}/deliver`, { payments: [{ method: 'cash', amountCents: 4000 }] });
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
    expect(delivered.body.warrantyUntil).toBeNull();
    const sale = await t.db.sale.findUniqueOrThrow({ where: { serviceOrderId: os.id }, include: { items: true } });
    expect(sale.totalCents).toBe(4000);
    expect(sale.items.map((line) => line.name)).toEqual(['Taxa de diagnóstico']);
    expect((await t.db.product.findUniqueOrThrow({ where: { id: screen.id } })).stockQty).toBe(1);
  });

  it('recusa sem taxa com sinal estorna o sinal e precisa de autorização', async () => {
    const os = await newOrder(owner, { technicianId: t.base.users.get('diego') });
    expect((await quote(owner, os.id, [labor(30000)])).status).toBe(200);
    expect((await cashier.post(`/api/service-orders/${os.id}/deposit`, { payments: [{ method: 'pix', amountCents: 5000 }] })).status).toBe(200);
    const body = { decision: 'rejected', by: 'Marina', channel: 'presencial' };
    const denied = await diego.post(`/api/service-orders/${os.id}/approval`, body);
    expect(denied.status).toBe(403);
    expect((await t.db.serviceOrder.findUniqueOrThrow({ where: { id: os.id } })).approvalStatus).toBeNull();
    const done = await diego.post(`/api/service-orders/${os.id}/approval`, { ...body, approval: APPROVAL });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.column.stageType).toBe('cancelled');
    expect(done.body.paidCents).toBe(0);
    const reversal = await t.db.cashMovement.findFirstOrThrow({ where: { type: 'reversal', refId: os.id } });
    expect(reversal.amountCents).toBe(5000);
  });
});

describe('cancelar venda de OS', () => {
  it('estorna tudo, devolve a peça e leva a OS para Cancelado sem garantia', async () => {
    const battery = await createProduct(t.db, { name: 'Bateria Moto G', priceCents: 9000, costCents: 4000, stockQty: 2 });
    const os = await newOrder(owner, { brand: 'Motorola', model: 'Moto G84' });
    await makeReady(os.id, [part(battery, 9000), labor(6000)]);
    expect((await cashier.post(`/api/service-orders/${os.id}/deposit`, { payments: [{ method: 'cash', amountCents: 5000 }] })).status).toBe(200);
    const delivered = await cashier.post(`/api/service-orders/${os.id}/deliver`, { payments: [{ method: 'debit', amountCents: 10000 }] });
    expect(delivered.status).toBe(200);
    expect((await t.db.product.findUniqueOrThrow({ where: { id: battery.id } })).stockQty).toBe(1);
    const sale = await t.db.sale.findUniqueOrThrow({ where: { serviceOrderId: os.id } });
    const cancelled = await owner.post(`/api/sales/${sale.id}/cancel`, { reason: 'Defeito voltou' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect((await t.db.product.findUniqueOrThrow({ where: { id: battery.id } })).stockQty).toBe(2);
    const reversed = await t.db.cashMovement.findMany({ where: { type: 'reversal', refId: sale.id } });
    expect(reversed.reduce((sum, row) => sum + row.amountCents, 0)).toBe(15000);
    const detail = (await owner.get(`/api/service-orders/${os.id}`)).body;
    expect(detail.column.stageType).toBe('cancelled');
    expect(detail.warrantyUntil).toBeNull();
    expect(detail.balanceCents).toBe(0);
  });
});

describe('transação da entrega', () => {
  for (const point of ['os.deliver.after_stock', 'os.deliver.after_payments']) {
    it(`falha em ${point} não deixa venda, pagamento nem baixa`, async () => {
      const film = await createProduct(t.db, { name: `Película ${point}`, priceCents: 3000, costCents: 800, stockQty: 5 });
      const os = await newOrder(owner);
      await makeReady(os.id, [part(film, 3000), labor(2000)]);
      const before = await tableCounts(t.db);
      const events = await t.db.serviceOrderEvent.count({ where: { serviceOrderId: os.id } });
      t.deps.failpoints.add(point);
      const failed = await cashier.post(`/api/service-orders/${os.id}/deliver`, { payments: [{ method: 'pix', amountCents: 5000 }] });
      expect(failed.status).toBe(500);
      expect(await tableCounts(t.db)).toEqual(before);
      expect(await t.db.serviceOrderEvent.count({ where: { serviceOrderId: os.id } })).toBe(events);
      const stored = await t.db.serviceOrder.findUniqueOrThrow({ where: { id: os.id } });
      expect(stored.columnId).toBe(column('Pronto para retirada'));
      expect(stored.deliveredAt).toBeNull();
      t.deps.failpoints.clear();
      expect((await cashier.post(`/api/service-orders/${os.id}/deliver`, { payments: [{ method: 'pix', amountCents: 5000 }] })).status).toBe(200);
    });
  }
});
