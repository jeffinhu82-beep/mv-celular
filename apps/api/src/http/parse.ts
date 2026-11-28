import type { z } from 'zod';
import { badRequest } from '../lib/errors.ts';

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  return schema.parse(data ?? {});
}

export function pageParams(query: Record<string, string | undefined>, defaultSize = 50) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize ?? defaultSize) || defaultSize));
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

export function requireUuid(value: string | undefined, label = 'Identificador'): string {
  if (!value || !/^[0-9a-f-]{36}$/i.test(value)) throw badRequest(`${label} inválido.`);
  return value;
}

export function flag(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}
