import { assertInteger, percentOfBps, sum } from './rounding.ts';

export type DiscountMode = 'amount' | 'percent';

export interface DiscountInput {
  mode: DiscountMode;
  value: number;
}

export const NO_DISCOUNT: DiscountInput = { mode: 'amount', value: 0 };

export interface CartItemInput {
  qty: number;
  unitPriceCents: number;
  unitCostCents?: number;
  discount?: DiscountInput;
}

export interface CartItemTotals {
  grossCents: number;
  discountCents: number;
  totalCents: number;
  costCents: number;
}

export interface CartTotals {
  items: CartItemTotals[];
  grossCents: number;
  itemsDiscountCents: number;
  subtotalCents: number;
  totalDiscountCents: number;
  discountCents: number;
  totalCents: number;
  costCents: number;
  effectiveDiscountBps: number;
}

export function resolveDiscount(baseCents: number, discount: DiscountInput | undefined): number {
  if (!discount || discount.value <= 0 || baseCents <= 0) return 0;
  assertInteger(discount.value, 'desconto');
  const raw = discount.mode === 'percent' ? percentOfBps(baseCents, Math.min(discount.value, 10000)) : discount.value;
  return Math.min(raw, baseCents);
}

export function computeItem(item: CartItemInput): CartItemTotals {
  assertInteger(item.qty, 'quantidade');
  assertInteger(item.unitPriceCents, 'preço');
  if (item.qty <= 0) throw new Error('Quantidade precisa ser maior que zero');
  if (item.unitPriceCents < 0) throw new Error('Preço não pode ser negativo');
  const grossCents = item.qty * item.unitPriceCents;
  const discountCents = resolveDiscount(grossCents, item.discount);
  return {
    grossCents,
    discountCents,
    totalCents: grossCents - discountCents,
    costCents: item.qty * (item.unitCostCents ?? 0),
  };
}

export function computeCart(items: CartItemInput[], totalDiscount?: DiscountInput): CartTotals {
  const computed = items.map(computeItem);
  const grossCents = sum(computed.map((item) => item.grossCents));
  const itemsDiscountCents = sum(computed.map((item) => item.discountCents));
  const subtotalCents = sum(computed.map((item) => item.totalCents));
  const totalDiscountCents = resolveDiscount(subtotalCents, totalDiscount);
  const discountCents = itemsDiscountCents + totalDiscountCents;
  const effectiveDiscountBps = grossCents > 0 ? Math.ceil((discountCents * 10000) / grossCents) : 0;
  return {
    items: computed,
    grossCents,
    itemsDiscountCents,
    subtotalCents,
    totalDiscountCents,
    discountCents,
    totalCents: subtotalCents - totalDiscountCents,
    costCents: sum(computed.map((item) => item.costCents)),
    effectiveDiscountBps,
  };
}

export function marginBps(priceCents: number, costCents: number): number | null {
  if (priceCents <= 0) return null;
  return Math.round(((priceCents - costCents) * 10000) / priceCents);
}

export function weightedAverageCost(
  currentQty: number,
  currentCostCents: number,
  incomingQty: number,
  incomingCostCents: number,
): number {
  const baseQty = Math.max(currentQty, 0);
  const totalQty = baseQty + incomingQty;
  if (totalQty <= 0) return incomingCostCents;
  return Math.round((baseQty * currentCostCents + incomingQty * incomingCostCents) / totalQty);
}
