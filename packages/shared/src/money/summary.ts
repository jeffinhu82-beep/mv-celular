import { PAYMENT_METHODS, type PaymentMethod } from './fees.ts';
import { sum } from './rounding.ts';

export const CASH_MOVEMENT_TYPES = ['payment', 'income', 'supply', 'withdrawal', 'expense', 'reversal'] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

export const CASH_MOVEMENT_LABELS: Record<CashMovementType, string> = {
  payment: 'Recebimento',
  income: 'Entrada avulsa',
  supply: 'Suprimento',
  withdrawal: 'Sangria',
  expense: 'Custo',
  reversal: 'Estorno',
};

export interface LedgerMovement {
  type: CashMovementType;
  method: PaymentMethod;
  amountCents: number;
  feeCents: number;
  fromDrawer: boolean;
}

export function movesDrawer(movement: LedgerMovement): boolean {
  switch (movement.type) {
    case 'supply':
    case 'withdrawal':
      return true;
    case 'expense':
      return movement.fromDrawer;
    default:
      return movement.method === 'cash';
  }
}

export function drawerDelta(movement: LedgerMovement): number {
  if (!movesDrawer(movement)) return 0;
  switch (movement.type) {
    case 'payment':
    case 'income':
    case 'supply':
      return movement.amountCents;
    case 'withdrawal':
    case 'expense':
    case 'reversal':
      return -movement.amountCents;
  }
}

export function expectedCashCents(openingCents: number, movements: LedgerMovement[]): number {
  return openingCents + sum(movements.map(drawerDelta));
}

export type MethodTotals = Record<PaymentMethod, number>;

export function emptyMethodTotals(): MethodTotals {
  return { cash: 0, pix: 0, debit: 0, credit: 0 };
}

export function expectedByMethod(openingCents: number, movements: LedgerMovement[]): MethodTotals {
  const totals = emptyMethodTotals();
  totals.cash = expectedCashCents(openingCents, movements);
  for (const movement of movements) {
    if (movement.method === 'cash') continue;
    if (movement.type === 'payment' || movement.type === 'income') totals[movement.method] += movement.amountCents;
    if (movement.type === 'reversal') totals[movement.method] -= movement.amountCents;
  }
  return totals;
}

export interface CashClosing {
  expectedCashCents: number;
  countedCashCents: number;
  differenceCents: number;
  requiresNote: boolean;
}

export function closeCash(expectedCash: number, countedCashCents: number): CashClosing {
  const differenceCents = countedCashCents - expectedCash;
  return {
    expectedCashCents: expectedCash,
    countedCashCents,
    differenceCents,
    requiresNote: differenceCents !== 0,
  };
}

export interface MethodBreakdown {
  method: PaymentMethod;
  grossCents: number;
  feeCents: number;
  netCents: number;
}

export interface SummaryInput {
  movements: LedgerMovement[];
  cmvCents: number;
  salesCount: number;
  salesTotalCents: number;
}

export interface SummaryResult {
  receivedCents: number;
  salesCount: number;
  salesTotalCents: number;
  averageTicketCents: number;
  incomeCents: number;
  supplyCents: number;
  withdrawalCents: number;
  feeCents: number;
  cmvCents: number;
  expenseCents: number;
  resultCents: number;
  byMethod: MethodBreakdown[];
}

export function summarize(input: SummaryInput): SummaryResult {
  const of = (type: CashMovementType) => input.movements.filter((movement) => movement.type === type);
  const payments = of('payment');
  const reversals = of('reversal');
  const incomes = of('income');

  const receivedCents = sum(payments.map((m) => m.amountCents)) - sum(reversals.map((m) => m.amountCents));
  const feeCents = sum(payments.map((m) => m.feeCents)) - sum(reversals.map((m) => m.feeCents));
  const incomeCents = sum(incomes.map((m) => m.amountCents));
  const supplyCents = sum(of('supply').map((m) => m.amountCents));
  const withdrawalCents = sum(of('withdrawal').map((m) => m.amountCents));
  const expenseCents = sum(of('expense').map((m) => m.amountCents));

  const byMethod = PAYMENT_METHODS.map((method) => {
    const matches = (m: LedgerMovement) => m.method === method;
    const grossCents =
      sum(payments.filter(matches).map((m) => m.amountCents)) +
      sum(incomes.filter(matches).map((m) => m.amountCents)) -
      sum(reversals.filter(matches).map((m) => m.amountCents));
    const methodFee =
      sum(payments.filter(matches).map((m) => m.feeCents)) - sum(reversals.filter(matches).map((m) => m.feeCents));
    return { method, grossCents, feeCents: methodFee, netCents: grossCents - methodFee };
  });

  return {
    receivedCents,
    salesCount: input.salesCount,
    salesTotalCents: input.salesTotalCents,
    averageTicketCents: input.salesCount > 0 ? Math.round(input.salesTotalCents / input.salesCount) : 0,
    incomeCents,
    supplyCents,
    withdrawalCents,
    feeCents,
    cmvCents: input.cmvCents,
    expenseCents,
    resultCents: receivedCents + incomeCents - feeCents - input.cmvCents - expenseCents,
    byMethod,
  };
}
