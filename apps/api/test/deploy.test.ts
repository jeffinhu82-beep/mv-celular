import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapStore } from '../src/seed/bootstrap.ts';
import { PASSWORD, resetDatabase, setupTestApp, type TestApp } from './helpers.ts';

let t: TestApp;

beforeAll(async () => {
  t = await setupTestApp({ config: { clientIpHeader: 'cf-connecting-ip', loginRateLimitPerMinute: 3 } });
});

afterAll(async () => {
  await t.app.close();
});

function login(headers: Record<string, string>, body: { login: string; password: string }) {
  return t.app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: body });
}

describe('IP do cliente atrás da Cloudflare', () => {
  it('limita o login pelo IP do cabeçalho, mesmo trocando o X-Forwarded-For', async () => {
    const wrong = { login: 'ninguem@loja.test', password: 'errada123' };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await login({ 'cf-connecting-ip': '198.51.100.20', 'x-forwarded-for': `203.0.113.${attempt}` }, wrong);
      expect(response.statusCode).toBe(401);
    }
    const limited = await login({ 'cf-connecting-ip': '198.51.100.20', 'x-forwarded-for': '203.0.113.99' }, wrong);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMIT');
    const other = await login({ 'cf-connecting-ip': '198.51.100.21' }, wrong);
    expect(other.statusCode).toBe(401);
  });

  it('grava na auditoria e na sessão o IP do cabeçalho, e cai no IP da conexão sem ele', async () => {
    const viaCloudflare = await login({ 'cf-connecting-ip': '198.51.100.30', 'x-forwarded-for': '203.0.113.50' }, { login: 'admin', password: PASSWORD });
    expect(viaCloudflare.statusCode).toBe(200);
    const direct = await login({}, { login: 'ana', password: PASSWORD });
    expect(direct.statusCode).toBe(200);

    const audits = await t.db.auditLog.findMany({ where: { action: 'auth.login' }, select: { userId: true, ip: true } });
    expect(audits).toContainEqual({ userId: t.base.users.get('admin')!, ip: '198.51.100.30' });
    expect(audits).toContainEqual({ userId: t.base.users.get('ana')!, ip: '127.0.0.1' });
  });
});

describe('primeira subida em produção', () => {
  const env = { ADMIN_NAME: 'Dona da Loja', ADMIN_EMAIL: ' Dona@Loja.TEST ', ADMIN_PASSWORD: 'provisoria-1', STORE_NAME: 'Loja Teste' };

  it('cria só a estrutura e um administrador que precisa trocar a senha', async () => {
    await resetDatabase(t.db);
    expect(await bootstrapStore(t.db, { ...env, ADMIN_EMAIL: '' })).toBe('no_admin');
    await expect(bootstrapStore(t.db, { ...env, ADMIN_PASSWORD: 'curta' })).rejects.toThrow('A senha precisa ter pelo menos 8 caracteres');
    expect(await t.db.user.count()).toBe(0);

    expect(await bootstrapStore(t.db, env)).toBe('created');
    const users = await t.db.user.findMany({ include: { role: true } });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: 'dona@loja.test', name: 'Dona da Loja', mustChangePassword: true, role: { slug: 'admin' } });
    expect(await t.db.storeSettings.findFirstOrThrow()).toMatchObject({ name: 'Loja Teste', document: null, whatsapp: null, pixKey: null, address: null });
    expect(await t.db.product.count()).toBe(0);
    expect(await t.db.kanbanColumn.count()).toBeGreaterThan(0);
    expect(await t.db.role.count()).toBe(3);

    const session = await login({ 'cf-connecting-ip': '198.51.100.40' }, { login: 'dona@loja.test', password: 'provisoria-1' });
    expect(session.statusCode).toBe(200);
    const cookie = String(session.headers['set-cookie']).split(';')[0]!;
    const blocked = await t.app.inject({ method: 'GET', url: '/api/customers', headers: { cookie } });
    expect(blocked.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    expect(await bootstrapStore(t.db, { ...env, ADMIN_EMAIL: 'outra@loja.test' })).toBe('has_users');
    expect(await t.db.user.count()).toBe(1);
  });
});
