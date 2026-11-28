import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type Client, type TestApp } from './helpers.ts';

let t: TestApp;
let admin: Client;
let cashier: Client;

beforeAll(async () => {
  t = await setupTestApp();
  admin = await t.login('admin');
  cashier = await t.login('ana');
});

afterAll(async () => {
  await t.app.close();
});

describe('autenticação', () => {
  it('bloqueia o login depois de 5 senhas erradas e registra no log', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await t.anonymous.post('/api/auth/login', { login: 'rafael', password: 'errada123' });
      expect(response.status).toBe(401);
    }
    const locked = await t.anonymous.post('/api/auth/login', { login: 'rafael', password: 'errada123' });
    expect(locked.status).toBe(423);
    const blocked = await t.anonymous.post('/api/auth/login', { login: 'rafael', password: 'loja12345' });
    expect(blocked.status).toBe(423);
    t.clock.advanceMinutes(16);
    const ok = await t.anonymous.post('/api/auth/login', { login: 'rafael', password: 'loja12345' });
    expect(ok.status).toBe(200);
    expect(await t.db.auditLog.count({ where: { action: 'auth.locked' } })).toBe(1);
  });

  it('usuário novo troca a senha temporária antes de usar o sistema', async () => {
    const role = await t.db.role.findFirstOrThrow({ where: { slug: 'cashier' } });
    const created = await admin.post('/api/users', { name: 'Paula Nunes', login: 'paula', email: 'paula@loja.test', roleId: role.id, temporaryPassword: 'temporaria1' });
    expect(created.status).toBe(200);
    const paula = await t.login('paula', 'temporaria1');
    expect((await paula.get('/api/customers')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const changed = await paula.post('/api/auth/change-password', { currentPassword: 'temporaria1', newPassword: 'nova-senha-1' });
    expect(changed.status).toBe(200);
    expect((await paula.get('/api/customers')).status).toBe(200);
  });

  it('entra pelo e-mail sem diferenciar maiúsculas, e o e-mail é único', async () => {
    const byEmail = await t.anonymous.post('/api/auth/login', { login: '  Ana@Loja.TEST ', password: 'loja12345' });
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.user).toMatchObject({ login: 'ana', email: 'ana@loja.test' });
    const wrong = await t.anonymous.post('/api/auth/login', { login: 'ana@loja.test', password: 'errada123' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.message).toBe('E-mail ou senha incorretos.');
    expect((await t.anonymous.post('/api/auth/login', { login: 'ninguem@loja.test', password: 'loja12345' })).status).toBe(401);

    const role = await t.db.role.findFirstOrThrow({ where: { slug: 'cashier' } });
    const missing = await admin.post('/api/users', { name: 'Sem Email', login: 'semail', roleId: role.id, temporaryPassword: 'temporaria1' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.issues[0].path).toBe('email');
    const taken = await admin.post('/api/users', { name: 'Outra Ana', login: 'outraana', email: 'ANA@loja.test', roleId: role.id, temporaryPassword: 'temporaria1' });
    expect(taken.status).toBe(400);
    expect(taken.body.error.details.issues).toEqual([{ path: 'email', message: 'Esse e-mail já está em uso.' }]);

    const diegoId = t.base.users.get('diego')!;
    const clash = await admin.put(`/api/users/${diegoId}`, { email: 'ana@loja.test' });
    expect(clash.status).toBe(400);
    const changed = await admin.put(`/api/users/${diegoId}`, { email: 'Diego.Ramos@loja.test' });
    expect(changed.status).toBe(200);
    expect(changed.body.email).toBe('diego.ramos@loja.test');
    expect((await t.anonymous.post('/api/auth/login', { login: 'diego.ramos@loja.test', password: 'loja12345' })).status).toBe(200);
    expect((await t.anonymous.post('/api/auth/login', { login: 'diego', password: 'loja12345' })).status).toBe(200);
  });

  it('sessão expira', async () => {
    const session = await t.login('admin');
    t.clock.advanceMinutes(13 * 60);
    expect((await session.get('/api/auth/me')).status).toBe(401);
    admin = await t.login('admin');
    cashier = await t.login('ana');
  });
});

describe('clientes', () => {
  it('avisa telefone repetido sem bloquear', async () => {
    const first = await cashier.post('/api/customers', { name: 'Paulo Teste', phone: '(48) 97777-1111' });
    expect(first.status).toBe(200);
    expect(first.body.customer.phoneE164).toBe('+5548977771111');
    const second = await cashier.post('/api/customers', { name: 'Paulo T.', phone: '48977771111' });
    expect(second.status).toBe(200);
    expect(second.body.duplicates).toHaveLength(1);
  });

  it('valida CPF', async () => {
    const response = await cashier.post('/api/customers', { name: 'X', phone: '48977771112', cpf: '123.456.789-00' });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('CPF inválido');
  });

  it('anonimiza mantendo o registro', async () => {
    const id = t.catalog.customers.get('Gustavo Ribeiro')!;
    expect((await cashier.post(`/api/customers/${id}/anonymize`)).status).toBe(403);
    expect((await admin.post(`/api/customers/${id}/anonymize`)).status).toBe(200);
    const row = await t.db.customer.findUniqueOrThrow({ where: { id } });
    expect(row.name).toBe('Cliente anonimizado');
    expect(row.phoneE164).toBe('');
    expect(await t.db.auditLog.count({ where: { action: 'customer.anonymized', entityId: id } })).toBe(1);
  });
});

describe('produtos e estoque', () => {
  it('entrada atualiza o custo médio ponderado', async () => {
    const productId = t.catalog.products.get('CAR-25W')!;
    const response = await admin.post('/api/stock/entries', { productId, qty: 5, unitCostCents: 3600 });
    expect(response.status).toBe(200);
    const product = await t.db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.stockQty).toBe(20);
    expect(product.costCents).toBe(3000);
  });

  it('ajuste exige motivo e fica no log', async () => {
    const productId = t.catalog.products.get('FON-P2')!;
    expect((await admin.post('/api/stock/adjustments', { productId, qtyDelta: -2, reason: '' })).status).toBe(400);
    expect((await admin.post('/api/stock/adjustments', { productId, qtyDelta: -2, reason: 'Avaria na vitrine' })).status).toBe(200);
    const product = await t.db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.stockQty).toBe(20);
    expect(await t.db.auditLog.count({ where: { action: 'stock.adjusted', entityId: productId } })).toBe(1);
  });

  it('caixa não recebe custo nem margem pela API', async () => {
    const list = await cashier.get('/api/products?q=Cabo');
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    for (const item of list.body.items) {
      expect(item).not.toHaveProperty('costCents');
      expect(item).not.toHaveProperty('marginBps');
    }
    const adminList = await admin.get('/api/products?q=Cabo');
    expect(adminList.body.items[0]).toHaveProperty('costCents');
  });

  it('alteração de preço fica no log', async () => {
    const id = t.catalog.products.get('CAB-CC1')!;
    const current = (await admin.get(`/api/products/${id}`)).body;
    const response = await admin.put(`/api/products/${id}`, {
      type: 'product',
      name: current.name,
      sku: current.sku,
      barcode: current.barcode,
      categoryId: current.categoryId,
      costCents: current.costCents,
      priceCents: 3290,
      minStock: current.minStock,
      tracksStock: true,
      active: true,
    });
    expect(response.status).toBe(200);
    expect(await t.db.auditLog.count({ where: { action: 'product.price_changed', entityId: id } })).toBe(1);
  });

  it('quem edita produto sem ver custo não apaga o custo', async () => {
    const role = await admin.post('/api/roles', { name: 'Cadastro', discountLimitBps: 0, permissions: ['product.manage'] });
    expect(role.status).toBe(200);
    const user = await admin.post('/api/users', { name: 'Lia Cadastro', login: 'lia', email: 'lia@loja.test', roleId: role.body.id, temporaryPassword: 'temporaria1' });
    expect(user.status).toBe(200);
    const lia = await t.login('lia', 'temporaria1');
    expect((await lia.post('/api/auth/change-password', { currentPassword: 'temporaria1', newPassword: 'novasenha1' })).status).toBe(200);
    const id = t.catalog.products.get('CAB-CC1')!;
    const costBefore = (await t.db.product.findUniqueOrThrow({ where: { id } })).costCents;
    const current = (await lia.get(`/api/products/${id}`)).body;
    expect(current).not.toHaveProperty('costCents');
    const response = await lia.put(`/api/products/${id}`, {
      type: 'product',
      name: `${current.name} (novo)`,
      sku: current.sku,
      barcode: current.barcode,
      categoryId: current.categoryId,
      priceCents: current.priceCents,
      minStock: current.minStock,
      tracksStock: true,
      active: true,
    });
    expect(response.status).toBe(200);
    expect((await t.db.product.findUniqueOrThrow({ where: { id } })).costCents).toBe(costBefore);
    expect(costBefore).toBeGreaterThan(0);
  });
});

describe('configurações', () => {
  it('caixa vê taxas mascaradas e admin vê as reais', async () => {
    const masked = await cashier.get('/api/settings/fees');
    expect(masked.body.rules.find((rule: { method: string }) => rule.method === 'pix').percentBps).toBe(0);
    const real = await admin.get('/api/settings/fees');
    expect(real.body.rules.find((rule: { method: string }) => rule.method === 'pix').percentBps).toBe(99);
  });

  it('mudança de permissões fica no log e não remove acesso do próprio admin', async () => {
    const roles = (await admin.get('/api/roles')).body as { id: string; slug: string; name: string; discountLimitBps: number; permissions: string[] }[];
    const tech = roles.find((role) => role.slug === 'technician')!;
    const response = await admin.put(`/api/roles/${tech.id}`, { name: tech.name, discountLimitBps: 0, permissions: [...tech.permissions, 'report.view'] });
    expect(response.status).toBe(200);
    expect(await t.db.auditLog.count({ where: { action: 'role.permissions_changed', entityId: tech.id } })).toBe(1);
    const adminRole = roles.find((role) => role.slug === 'admin')!;
    await admin.put(`/api/roles/${adminRole.id}`, { name: adminRole.name, discountLimitBps: 10000, permissions: [] });
    expect(await t.db.rolePermission.count({ where: { roleId: adminRole.id } })).toBe(adminRole.permissions.length);
  });
});
