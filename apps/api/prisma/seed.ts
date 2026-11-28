import { createPrisma } from '../src/db.ts';
import { seedBase, SEED_PASSWORD, SEED_USERS } from '../src/seed/base.ts';
import { seedCatalog } from '../src/seed/catalog.ts';
import { seedDemo } from '../src/seed/demo.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não configurada');
const db = createPrisma(url);

try {
  const users = await db.user.count();
  if (users > 0) {
    console.log('O banco já tem dados. Para recriar do zero, rode: pnpm db:reset');
  } else {
    const base = await seedBase(db);
    const catalog = await seedCatalog(db, base.users.get('admin')!);
    if (process.env.SEED_DEMO !== 'false') await seedDemo(db, base, catalog);
    console.log('Seed concluído. Usuários (senha', SEED_PASSWORD + '):', SEED_USERS.map((user) => user.login).join(', '));
  }
} finally {
  await db.$disconnect();
}
