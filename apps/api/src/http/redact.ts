import { can, type SessionUser } from '@loja/shared';

const ALWAYS_HIDDEN = new Set(['passwordHash', 'unlockSecretEnc']);
const COST_KEYS = new Set(['costCents', 'unitCostCents', 'marginBps', 'marginCents', 'cmvCents']);
const FINANCE_KEYS = new Set([
  'feeCents',
  'feePercentBps',
  'reversedFeeCents',
  'netCents',
  'resultCents',
  'feesCents',
  'cmvCents',
  'marginBps',
  'marginCents',
]);

function hiddenKeys(user: SessionUser | null): Set<string> {
  const hidden = new Set(ALWAYS_HIDDEN);
  if (!can(user, 'product.cost.view')) for (const key of COST_KEYS) hidden.add(key);
  if (!can(user, 'finance.view')) for (const key of FINANCE_KEYS) hidden.add(key);
  return hidden;
}

function strip(value: unknown, hidden: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => strip(item, hidden));
  if (value instanceof Date || value === null || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (hidden.has(key)) continue;
    output[key] = strip(item, hidden);
  }
  return output;
}

export function redactFor(user: SessionUser | null, payload: unknown): unknown {
  return strip(payload, hiddenKeys(user));
}
