import type { FastifyRequest } from 'fastify';

export function clientIp(req: FastifyRequest, header: string | null): string {
  if (!header) return req.ip;
  const value = req.headers[header];
  const first = (Array.isArray(value) ? value[0] : value)?.trim();
  return first || req.ip;
}
