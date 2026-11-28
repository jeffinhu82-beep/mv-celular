import { DEFAULT_ROLES, type PermissionKey } from '@loja/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type Client, type TestApp } from './helpers.ts';

const LOGIN_BY_ROLE: Record<string, string> = { admin: 'admin', cashier: 'ana', technician: 'diego' };
const FAKE_ID = '00000000-0000-4000-8000-000000000000';

let t: TestApp;
const clients = new Map<string, Client>();

beforeAll(async () => {
  t = await setupTestApp();
  for (const [role, login] of Object.entries(LOGIN_BY_ROLE)) clients.set(role, await t.login(login));
});

afterAll(async () => {
  await t.app.close();
});

function call(client: Client, method: string, url: string) {
  const path = url.replace(/:[a-zA-Z]+/g, FAKE_ID);
  if (method === 'GET') return client.get(path);
  if (method === 'DELETE') return client.delete(path);
  if (method === 'PUT') return client.put(path, {});
  if (method === 'PATCH') return client.patch(path, {});
  return client.post(path, {});
}

describe('permissões por rota', () => {
  it('toda rota protegida responde 401 sem sessão', async () => {
    const protectedRoutes = t.routes.filter((route) => route.access !== 'public');
    expect(protectedRoutes.length).toBeGreaterThan(20);
    for (const route of protectedRoutes) {
      const response = await call(t.anonymous, route.method, route.url);
      expect(response.status, `${route.method} ${route.url}`).toBe(401);
    }
  });

  it('cada perfil sem a chave recebe 403 em cada rota protegida', async () => {
    let checked = 0;
    for (const route of t.routes) {
      if (route.access === 'public' || route.access === 'auth') continue;
      const keys: PermissionKey[] = Array.isArray(route.access) ? route.access : [route.access];
      for (const role of DEFAULT_ROLES) {
        if (keys.some((key) => role.permissions.includes(key))) continue;
        const response = await call(clients.get(role.slug)!, route.method, route.url);
        expect(response.status, `${role.slug} → ${route.method} ${route.url}`).toBe(403);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});
