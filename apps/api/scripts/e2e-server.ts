import { execSync } from 'node:child_process';
import { createPrisma } from '../src/db.ts';
import { seedBase } from '../src/seed/base.ts';
import { seedCatalog } from '../src/seed/catalog.ts';
import { resetDatabase } from '../src/seed/reset.ts';

const url = process.env.E2E_DATABASE_URL;
if (!url) throw new Error('E2E_DATABASE_URL não configurada');
if (url === process.env.DATABASE_URL) throw new Error('E2E_DATABASE_URL não pode ser o banco de desenvolvimento');

process.env.DATABASE_URL = url;
process.env.API_PORT = process.env.E2E_API_PORT ?? '3391';
process.env.LOGIN_RATE_LIMIT = '10000';

execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });
const db = createPrisma(url);
try {
  await resetDatabase(db);
  const base = await seedBase(db);
  await seedCatalog(db, base.users.get('admin')!);
} finally {
  await db.$disconnect();
}

await import('../src/server.ts');
