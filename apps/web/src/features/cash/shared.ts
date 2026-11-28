import { CASH_MOVEMENT_LABELS, type CashMovementType } from '@loja/shared';
import type { CashMovementView } from '@/lib/types.ts';

const OUTFLOWS: CashMovementType[] = ['withdrawal', 'expense', 'reversal'];

export function signedAmount(movement: Pick<CashMovementView, 'type' | 'amountCents'>): number {
  return OUTFLOWS.includes(movement.type) ? -movement.amountCents : movement.amountCents;
}

export function movementLabel(movement: Pick<CashMovementView, 'type' | 'refType'>): string {
  if (movement.type === 'payment' && movement.refType === 'ServiceOrder') return 'Recebimento de OS';
  if (movement.type === 'payment') return 'Recebimento de venda';
  return CASH_MOVEMENT_LABELS[movement.type];
}

export function refLink(movement: Pick<CashMovementView, 'refType' | 'refId'>): string | null {
  if (!movement.refId) return null;
  if (movement.refType === 'Sale') return `/vendas/${movement.refId}`;
  if (movement.refType === 'ServiceOrder') return `/os/${movement.refId}`;
  return null;
}

export function totalsByType(movements: CashMovementView[]): Record<CashMovementType, number> {
  const totals: Record<CashMovementType, number> = { payment: 0, income: 0, supply: 0, withdrawal: 0, expense: 0, reversal: 0 };
  for (const movement of movements) totals[movement.type] += movement.amountCents;
  return totals;
}
