import { createPrisma } from '../src/db.ts';
import { bootstrapStore } from '../src/seed/bootstrap.ts';

const MESSAGES = {
  created: 'Loja criada. Entre com ADMIN_EMAIL e ADMIN_PASSWORD; o sistema pede uma senha nova no primeiro acesso. Depois apague ADMIN_PASSWORD das variáveis.',
  has_users: 'Banco já tem usuários: nada a criar.',
  no_admin: 'Banco vazio e ADMIN_EMAIL não definido: ninguém consegue entrar até rodar com ADMIN_NAME, ADMIN_EMAIL e ADMIN_PASSWORD.',
};

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não configurada');
const db = createPrisma(url);

try {
  console.log(MESSAGES[await bootstrapStore(db, process.env)]);
} finally {
  await db.$disconnect();
}
