import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { mkdirSync } from 'node:fs';
import { ZodError } from 'zod';
import type { AppConfig } from './config.ts';
import type { Db } from './db.ts';
import type { Deps } from './deps.ts';
import { systemClock, type Clock } from './lib/clock.ts';
import { AppError } from './lib/errors.ts';
import { UPLOAD_DIR } from './lib/paths.ts';
import { resolveSession, SESSION_COOKIE } from './http/auth.ts';
import { clientIp } from './http/client-ip.ts';
import { redactFor } from './http/redact.ts';
import { Router, type RouteInfo } from './http/router.ts';
import { registerModules } from './modules/index.ts';

export interface BuildOptions {
  config: AppConfig;
  db: Db;
  clock?: Clock;
}

function prismaCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^P\d{4}$/.test(error.code)) {
    return error.code;
  }
  return null;
}

export async function buildApp(options: BuildOptions) {
  const deps: Deps = {
    db: options.db,
    config: options.config,
    clock: options.clock ?? systemClock,
    failpoints: new Set(),
  };
  const app = Fastify({ logger: options.config.logger ? { level: 'info' } : false, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });

  await app.register(cookie);
  await app.register(rateLimit, { global: false, keyGenerator: (req) => clientIp(req, options.config.clientIpHeader) });
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
  mkdirSync(UPLOAD_DIR, { recursive: true });
  await app.register(fastifyStatic, { root: UPLOAD_DIR, prefix: '/uploads/', decorateReply: false });

  app.decorateRequest('sessionUser', null);
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    req.sessionUser = await resolveSession(deps, req.cookies[SESSION_COOKIE]);
  });
  app.addHook('preSerialization', async (req, _reply, payload) => redactFor(req.sessionUser, payload));

  app.setErrorHandler((error: FastifyError | Error, req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
      return reply.status(400).send({ error: { code: 'VALIDATION', message: issues[0]?.message ?? 'Dados inválidos.', details: { issues } } });
    }
    const code = prismaCode(error);
    if (code === 'P2002') {
      return reply.status(409).send({ error: { code: 'DUPLICATE', message: 'Já existe um registro com esse valor.' } });
    }
    if (code === 'P2025') {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Registro não encontrado.' } });
    }
    const status = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status === 429) {
      return reply.status(429).send({ error: { code: 'RATE_LIMIT', message: 'Muitas tentativas. Aguarde um minuto.' } });
    }
    if (status < 500) {
      return reply.status(status).send({ error: { code: 'BAD_REQUEST', message: 'Requisição inválida.' } });
    }
    req.log.error(error);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Erro inesperado. Tente de novo.' } });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } }));

  const table: RouteInfo[] = [];
  const router = new Router(app, deps, table);
  registerModules(router);

  app.get('/api/health', async () => ({ ok: true }));

  return { app, deps, routes: table };
}
