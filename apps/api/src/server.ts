import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPrisma } from './db.ts';

const config = loadConfig();
const db = createPrisma(config.databaseUrl);
const { app } = await buildApp({ config, db });

const shutdown = async () => {
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
