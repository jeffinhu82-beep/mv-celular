import { formatSequence } from '@loja/shared';
import type { Tx } from '../db.ts';

export const COUNTER_PREFIX = { sale: 'V', os: 'OS', quote: 'ORC' } as const;
export type CounterKey = keyof typeof COUNTER_PREFIX;

export async function nextNumber(tx: Tx, key: CounterKey): Promise<string> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value", "updatedAt") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1, "updatedAt" = now()
    RETURNING "value"`;
  const value = rows[0]?.value;
  if (!value) throw new Error(`Falha ao gerar numeração para ${key}`);
  return formatSequence(COUNTER_PREFIX[key], Number(value));
}
