import type { FeeRule } from '@loja/shared';
import { buildApp } from '../src/app.ts';
import { loadConfig, type AppConfig } from '../src/config.ts';
import { createPrisma, type Db } from '../src/db.ts';
import { FixedClock } from '../src/lib/clock.ts';
import { seedBase } from '../src/seed/base.ts';
import { seedCatalog } from '../src/seed/catalog.ts';
import { resetDatabase } from '../src/seed/reset.ts';

export { resetDatabase };

export const PASSWORD = 'loja12345';

export const TEST_FEES: Partial<Record<string, number>> = {
  'pix:1': 99,
  'debit:1': 199,
  'credit:1': 349,
  'credit:2': 449,
  'credit:3': 499,
};

let shared: Db | null = null;

export function testDb(): Db {
  if (!shared) shared = createPrisma(process.env.TEST_DATABASE_URL!);
  return shared;
}


export async function setTestFees(db: Db, overrides: Partial<Record<string, Partial<FeeRule>>> = {}) {
  const rules = await db.feeRule.findMany();
  for (const rule of rules) {
    const key = `${rule.method}:${rule.installments}`;
    await db.feeRule.update({
      where: { id: rule.id },
      data: { percentBps: TEST_FEES[key] ?? 0, fixedCents: 0, passToCustomer: false, ...overrides[key] },
    });
  }
  const settings = await db.storeSettings.findFirstOrThrow();
  await db.storeSettings.update({ where: { id: settings.id }, data: { minInstallmentCents: 0 } });
}

export interface Client {
  cookie: string;
  get(url: string): Promise<Res>;
  post(url: string, body?: unknown): Promise<Res>;
  put(url: string, body?: unknown): Promise<Res>;
  patch(url: string, body?: unknown): Promise<Res>;
  delete(url: string, body?: unknown): Promise<Res>;
}

export interface Res {
  status: number;
  body: any;
}

export async function setupTestApp(options: { now?: string; fees?: boolean; config?: Partial<AppConfig> } = {}) {
  const db = testDb();
  await resetDatabase(db);
  const base = await seedBase(db, { password: PASSWORD });
  const catalog = await seedCatalog(db, base.users.get('admin')!);
  if (options.fees !== false) await setTestFees(db);
  const clock = new FixedClock(options.now ?? '2026-11-26T13:00:00Z');
  const config = loadConfig({ databaseUrl: process.env.TEST_DATABASE_URL!, logger: false, loginRateLimitPerMinute: 10000, ...options.config });
  const { app, deps, routes } = await buildApp({ config, db, clock });
  await app.ready();

  const request = async (cookie: string, method: string, url: string, body?: unknown): Promise<Res> => {
    const response = await app.inject({
      method: method as 'GET',
      url,
      headers: cookie ? { cookie } : {},
      ...(body === undefined ? {} : { payload: body as object }),
    });
    let parsed: unknown = null;
    try {
      parsed = response.json();
    } catch {
      parsed = response.body;
    }
    return { status: response.statusCode, body: parsed };
  };

  const client = (cookie: string): Client => ({
    cookie,
    get: (url) => request(cookie, 'GET', url),
    post: (url, body) => request(cookie, 'POST', url, body ?? {}),
    put: (url, body) => request(cookie, 'PUT', url, body ?? {}),
    patch: (url, body) => request(cookie, 'PATCH', url, body ?? {}),
    delete: (url, body) => request(cookie, 'DELETE', url, body),
  });

  const login = async (loginName: string, password = PASSWORD): Promise<Client> => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: loginName, password } });
    if (response.statusCode !== 200) throw new Error(`Falha no login de ${loginName}: ${response.body}`);
    const raw = response.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw[0]! : String(raw);
    return client(header.split(';')[0]!);
  };

  return { app, deps, db, clock, routes, base, catalog, login, anonymous: client('') };
}

export type TestApp = Awaited<ReturnType<typeof setupTestApp>>;

export async function createProduct(db: Db, data: { name: string; priceCents: number; costCents?: number; stockQty?: number; minStock?: number }) {
  return db.product.create({
    data: { type: 'product', tracksStock: true, costCents: 0, stockQty: 10, minStock: 0, ...data },
  });
}

export function item(product: { id: string; name: string; priceCents: number }, qty = 1) {
  return { productId: product.id, name: product.name, qty, unitPriceCents: product.priceCents };
}

export async function tableCounts(db: Db) {
  const [sales, saleItems, payments, movements, stockMovements, audits, counters, products] = await Promise.all([
    db.sale.count(),
    db.saleItem.count(),
    db.payment.count(),
    db.cashMovement.count(),
    db.stockMovement.count(),
    db.auditLog.count(),
    db.counter.findMany({ orderBy: { key: 'asc' }, select: { key: true, value: true } }),
    db.product.findMany({ orderBy: { id: 'asc' }, select: { id: true, stockQty: true } }),
  ]);
  return { sales, saleItems, payments, movements, stockMovements, audits, counters, products };
}
