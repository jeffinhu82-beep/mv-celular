import { DIAGNOSIS_FEE_LABEL } from '@loja/shared';
import type { OsItemKind } from '../generated/prisma/client.ts';

export interface BillableLine {
  productId: string | null;
  kind: OsItemKind;
  name: string;
  qty: number;
  unitPriceCents: number;
  unitCostCents: number;
}

interface PricedOrder {
  approvalStatus: string | null;
  diagnosisFeeCents: number;
  discountCents: number;
  items: { qty: number; unitPriceCents: number }[];
}

interface OsLike extends PricedOrder {
  id: string;
  payments: { coveredCents: number; reversedAt: Date | null }[];
}

export function isRejected(os: Pick<PricedOrder, 'approvalStatus'>): boolean {
  return os.approvalStatus === 'rejected';
}

export function billableLines<T extends Omit<BillableLine, 'unitCostCents'> & { unitCostCents?: number }>(
  os: Omit<PricedOrder, 'items'> & { items: T[] },
): BillableLine[] {
  if (isRejected(os)) {
    if (os.diagnosisFeeCents <= 0) return [];
    return [{ productId: null, kind: 'service', name: DIAGNOSIS_FEE_LABEL, qty: 1, unitPriceCents: os.diagnosisFeeCents, unitCostCents: 0 }];
  }
  return os.items.map((item) => ({
    productId: item.productId,
    kind: item.kind,
    name: item.name,
    qty: item.qty,
    unitPriceCents: item.unitPriceCents,
    unitCostCents: item.unitCostCents ?? 0,
  }));
}

export function billableDiscount(os: Pick<PricedOrder, 'approvalStatus' | 'discountCents'>): number {
  return isRejected(os) ? 0 : os.discountCents;
}

export function serviceOrderGross(os: Pick<PricedOrder, 'items'>): number {
  return os.items.reduce((sum, item) => sum + item.qty * item.unitPriceCents, 0);
}

export function serviceOrderTotal(os: PricedOrder): number {
  if (isRejected(os)) return Math.max(0, os.diagnosisFeeCents);
  const gross = serviceOrderGross(os);
  return Math.max(0, gross - Math.min(os.discountCents, gross));
}

export function serviceOrderDeposit(os: Pick<OsLike, 'payments'>): number {
  return os.payments.filter((payment) => !payment.reversedAt).reduce((sum, payment) => sum + payment.coveredCents, 0);
}

export function serviceOrderBalances(orders: OsLike[]) {
  const map = new Map<string, { totalCents: number; paidCents: number; balanceCents: number }>();
  for (const os of orders) {
    const totalCents = serviceOrderTotal(os);
    const paidCents = serviceOrderDeposit(os);
    map.set(os.id, { totalCents, paidCents, balanceCents: totalCents - paidCents });
  }
  return map;
}
