import { PAYMENT_METHODS, MAX_CREDIT_INSTALLMENTS, type FeeConfig, type FeeRule } from '@loja/shared';
import type { Tx } from '../db.ts';

export async function getStoreSettings(tx: Tx) {
  const existing = await tx.storeSettings.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return existing;
  return tx.storeSettings.create({ data: { name: 'Minha Loja' } });
}

export function defaultFeeRules(): FeeRule[] {
  const rules: FeeRule[] = [];
  for (const method of PAYMENT_METHODS) {
    const count = method === 'credit' ? MAX_CREDIT_INSTALLMENTS : 1;
    for (let installments = 1; installments <= count; installments += 1) {
      rules.push({ method, installments, percentBps: 0, fixedCents: 0, passToCustomer: false });
    }
  }
  return rules;
}

export async function loadFeeConfig(tx: Tx): Promise<FeeConfig> {
  const settings = await getStoreSettings(tx);
  const rows = await tx.feeRule.findMany();
  const byKey = new Map(rows.map((row) => [`${row.method}:${row.installments}`, row]));
  const rules = defaultFeeRules().map((rule) => {
    const row = byKey.get(`${rule.method}:${rule.installments}`);
    return row
      ? { method: row.method, installments: row.installments, percentBps: row.percentBps, fixedCents: row.fixedCents, passToCustomer: row.passToCustomer }
      : rule;
  });
  return { rules, maxInstallments: settings.maxInstallments, minInstallmentCents: settings.minInstallmentCents };
}

export function maskFeeConfig(config: FeeConfig): FeeConfig {
  return {
    ...config,
    rules: config.rules.map((rule) => (rule.passToCustomer ? rule : { ...rule, percentBps: 0, fixedCents: 0 })),
  };
}
