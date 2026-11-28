import { chargeFor, findFeeRule, type FeeConfig, type PaymentMethod } from './fees.ts';
import { assertInteger, divRoundHalfUp, sum } from './rounding.ts';

export interface PaymentInput {
  method: PaymentMethod;
  amountCents: number;
  installments?: number;
}

export interface PaymentLine {
  method: PaymentMethod;
  installments: number;
  tenderedCents: number;
  coveredCents: number;
  chargedCents: number;
  surchargeCents: number;
  changeCents: number;
  feeCents: number;
  feePercentBps: number;
  netCents: number;
  installmentCents: number;
}

export interface CheckoutResult {
  lines: PaymentLine[];
  dueCents: number;
  coveredCents: number;
  chargedCents: number;
  changeCents: number;
  remainingCents: number;
  feeCents: number;
  netCents: number;
  errors: string[];
}

export function computeCheckout(dueCents: number, payments: PaymentInput[], config: FeeConfig): CheckoutResult {
  assertInteger(dueCents, 'total');
  const errors: string[] = [];
  const valid = payments.filter((payment) => {
    if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) {
      errors.push('Todo pagamento precisa ter valor maior que zero.');
      return false;
    }
    return true;
  });

  const nonCashCents = sum(valid.filter((p) => p.method !== 'cash').map((p) => p.amountCents));
  const cashCents = sum(valid.filter((p) => p.method === 'cash').map((p) => p.amountCents));

  if (nonCashCents > dueCents) {
    errors.push('Só o pagamento em dinheiro pode passar do total.');
  }

  const tenderedTotal = nonCashCents + cashCents;
  const changeTotal = Math.max(0, tenderedTotal - dueCents);
  const changeAvailable = Math.min(changeTotal, cashCents);
  let changeToAssign = changeAvailable;

  const changeByIndex = new Map<number, number>();
  for (let index = valid.length - 1; index >= 0 && changeToAssign > 0; index -= 1) {
    const payment = valid[index]!;
    if (payment.method !== 'cash') continue;
    const portion = Math.min(payment.amountCents, changeToAssign);
    changeByIndex.set(index, portion);
    changeToAssign -= portion;
  }

  const lines: PaymentLine[] = valid.map((payment, index) => {
    const installments = payment.method === 'credit' ? Math.max(1, payment.installments ?? 1) : 1;
    if (payment.method === 'credit') {
      if (installments > config.maxInstallments) {
        errors.push(`Parcelamento máximo é ${config.maxInstallments}x.`);
      }
    }
    const changeCents = changeByIndex.get(index) ?? 0;
    const coveredCents = payment.amountCents - changeCents;
    const rule = findFeeRule(config, payment.method, installments);
    const charge = chargeFor(coveredCents, rule);
    const installmentCents = divRoundHalfUp(charge.chargedCents, installments);
    if (
      payment.method === 'credit' &&
      installments > 1 &&
      config.minInstallmentCents > 0 &&
      installmentCents < config.minInstallmentCents
    ) {
      errors.push('A parcela ficou abaixo do valor mínimo permitido.');
    }
    return {
      method: payment.method,
      installments,
      tenderedCents: payment.amountCents + charge.surchargeCents,
      coveredCents,
      chargedCents: charge.chargedCents,
      surchargeCents: charge.surchargeCents,
      changeCents,
      feeCents: charge.feeCents,
      feePercentBps: charge.feePercentBps,
      netCents: charge.netCents,
      installmentCents,
    };
  });

  const coveredCents = sum(lines.map((line) => line.coveredCents));
  const feeCents = sum(lines.map((line) => line.feeCents));
  const chargedCents = sum(lines.map((line) => line.chargedCents));

  return {
    lines,
    dueCents,
    coveredCents,
    chargedCents,
    changeCents: changeAvailable,
    remainingCents: Math.max(0, dueCents - coveredCents),
    feeCents,
    netCents: chargedCents - feeCents,
    errors: [...new Set(errors)],
  };
}

export function isFullyPaid(result: CheckoutResult): boolean {
  return result.errors.length === 0 && result.remainingCents === 0;
}
