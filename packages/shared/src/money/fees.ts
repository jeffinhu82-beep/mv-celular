import { assertInteger, divRoundHalfUp, percentOfBps } from './rounding.ts';

export const PAYMENT_METHODS = ['cash', 'pix', 'debit', 'credit'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  pix: 'Pix',
  debit: 'Débito',
  credit: 'Crédito',
};

export const MAX_CREDIT_INSTALLMENTS = 12;

export interface FeeRule {
  method: PaymentMethod;
  installments: number;
  percentBps: number;
  fixedCents: number;
  passToCustomer: boolean;
}

export interface FeeConfig {
  rules: FeeRule[];
  maxInstallments: number;
  minInstallmentCents: number;
}

export const ZERO_FEE_RULE: Omit<FeeRule, 'method' | 'installments'> = {
  percentBps: 0,
  fixedCents: 0,
  passToCustomer: false,
};

export function findFeeRule(config: FeeConfig, method: PaymentMethod, installments = 1): FeeRule {
  const wantedInstallments = method === 'credit' ? installments : 1;
  const rule = config.rules.find(
    (candidate) => candidate.method === method && candidate.installments === wantedInstallments,
  );
  return rule ?? { method, installments: wantedInstallments, ...ZERO_FEE_RULE };
}

export function computeFee(amountCents: number, rule: Pick<FeeRule, 'percentBps' | 'fixedCents'>): number {
  assertInteger(amountCents);
  if (amountCents <= 0) return 0;
  return percentOfBps(amountCents, rule.percentBps) + rule.fixedCents;
}

export function grossUpForCustomer(
  desiredCents: number,
  rule: Pick<FeeRule, 'percentBps' | 'fixedCents'>,
): number {
  assertInteger(desiredCents);
  if (desiredCents <= 0) return 0;
  const keptBps = 10000 - rule.percentBps;
  if (keptBps <= 0) throw new Error('Percentual de taxa inválido para repasse');
  return divRoundHalfUp((desiredCents + rule.fixedCents) * 10000, keptBps);
}

export interface ChargeBreakdown {
  coveredCents: number;
  chargedCents: number;
  surchargeCents: number;
  feeCents: number;
  netCents: number;
  feePercentBps: number;
}

export function chargeFor(coveredCents: number, rule: FeeRule): ChargeBreakdown {
  const chargedCents = rule.passToCustomer ? grossUpForCustomer(coveredCents, rule) : coveredCents;
  const feeCents = computeFee(chargedCents, rule);
  return {
    coveredCents,
    chargedCents,
    surchargeCents: chargedCents - coveredCents,
    feeCents,
    netCents: chargedCents - feeCents,
    feePercentBps: rule.percentBps,
  };
}

export interface InstallmentOption {
  installments: number;
  installmentCents: number;
  chargedCents: number;
  feeCents: number;
  netCents: number;
  passToCustomer: boolean;
  allowed: boolean;
}

export function simulateInstallments(coveredCents: number, config: FeeConfig): InstallmentOption[] {
  const options: InstallmentOption[] = [];
  const limit = Math.min(Math.max(config.maxInstallments, 1), MAX_CREDIT_INSTALLMENTS);
  for (let installments = 1; installments <= limit; installments += 1) {
    const rule = findFeeRule(config, 'credit', installments);
    const charge = chargeFor(coveredCents, rule);
    const installmentCents = divRoundHalfUp(charge.chargedCents, installments);
    const allowed =
      installments === 1 || config.minInstallmentCents <= 0 || installmentCents >= config.minInstallmentCents;
    options.push({
      installments,
      installmentCents,
      chargedCents: charge.chargedCents,
      feeCents: charge.feeCents,
      netCents: charge.netCents,
      passToCustomer: rule.passToCustomer,
      allowed,
    });
  }
  return options;
}
