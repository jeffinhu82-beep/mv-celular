import { describe, expect, it } from 'vitest';
import {
  chargeFor,
  closeCash,
  computeCart,
  computeCheckout,
  computeFee,
  divRoundHalfUp,
  expectedByMethod,
  expectedCashCents,
  findFeeRule,
  grossUpForCustomer,
  isFullyPaid,
  percentOfBps,
  simulateInstallments,
  summarize,
  weightedAverageCost,
  type FeeConfig,
  type LedgerMovement,
} from '../src/money/index.ts';

const testFees: FeeConfig = {
  maxInstallments: 12,
  minInstallmentCents: 0,
  rules: [
    { method: 'cash', installments: 1, percentBps: 0, fixedCents: 0, passToCustomer: false },
    { method: 'pix', installments: 1, percentBps: 99, fixedCents: 0, passToCustomer: false },
    { method: 'debit', installments: 1, percentBps: 199, fixedCents: 0, passToCustomer: false },
    { method: 'credit', installments: 1, percentBps: 349, fixedCents: 0, passToCustomer: false },
    { method: 'credit', installments: 2, percentBps: 449, fixedCents: 0, passToCustomer: false },
    { method: 'credit', installments: 3, percentBps: 499, fixedCents: 0, passToCustomer: false },
  ],
};

const passThroughFees: FeeConfig = {
  ...testFees,
  rules: testFees.rules.map((rule) =>
    rule.method === 'credit' && rule.installments === 3 ? { ...rule, passToCustomer: true } : rule,
  ),
};

function paymentMovements(result: ReturnType<typeof computeCheckout>): LedgerMovement[] {
  return result.lines.map((line) => ({
    type: 'payment',
    method: line.method,
    amountCents: line.chargedCents,
    feeCents: line.feeCents,
    fromDrawer: false,
  }));
}

describe('arredondamento', () => {
  it('arredonda meio para cima', () => {
    expect(divRoundHalfUp(495000, 10000)).toBe(50);
    expect(divRoundHalfUp(494999, 10000)).toBe(49);
    expect(divRoundHalfUp(-495000, 10000)).toBe(-50);
    expect(percentOfBps(5000, 99)).toBe(50);
  });

  it('recusa valores que não são inteiros', () => {
    expect(() => percentOfBps(10.5, 99)).toThrow();
    expect(() => computeFee(0.1 + 0.2, { percentBps: 0, fixedCents: 0 })).toThrow();
  });

  it('soma taxa fixa por transação', () => {
    expect(computeFee(10000, { percentBps: 199, fixedCents: 35 })).toBe(234);
    expect(computeFee(0, { percentBps: 199, fixedCents: 35 })).toBe(0);
  });
});

describe('cenário A: crédito parcelado', () => {
  it('venda de R$ 300,00 no crédito 3x', () => {
    const result = computeCheckout(30000, [{ method: 'credit', amountCents: 30000, installments: 3 }], testFees);
    expect(result.feeCents).toBe(1497);
    expect(result.netCents).toBe(28503);
    expect(isFullyPaid(result)).toBe(true);
  });

  it('simulador mostra parcela, total e líquido', () => {
    const options = simulateInstallments(30000, testFees);
    const three = options.find((option) => option.installments === 3)!;
    expect(three.installmentCents).toBe(10000);
    expect(three.chargedCents).toBe(30000);
    expect(three.feeCents).toBe(1497);
    expect(three.netCents).toBe(28503);
    expect(options).toHaveLength(12);
  });

  it('simulador respeita parcela mínima', () => {
    const options = simulateInstallments(10000, { ...testFees, minInstallmentCents: 3000 });
    expect(options.find((option) => option.installments === 3)!.allowed).toBe(true);
    expect(options.find((option) => option.installments === 4)!.allowed).toBe(false);
  });
});

describe('cenário B: pagamento dividido', () => {
  it('R$ 100,00 no Pix e R$ 50,00 em dinheiro', () => {
    const result = computeCheckout(
      15000,
      [
        { method: 'pix', amountCents: 10000 },
        { method: 'cash', amountCents: 5000 },
      ],
      testFees,
    );
    expect(result.feeCents).toBe(99);
    expect(result.remainingCents).toBe(0);
    expect(isFullyPaid(result)).toBe(true);
  });

  it('bloqueia quando os pagamentos não fecham o total', () => {
    const result = computeCheckout(15000, [{ method: 'pix', amountCents: 10000 }], testFees);
    expect(result.remainingCents).toBe(5000);
    expect(isFullyPaid(result)).toBe(false);
  });

  it('só dinheiro pode passar do total', () => {
    const result = computeCheckout(15000, [{ method: 'pix', amountCents: 16000 }], testFees);
    expect(result.errors).toContain('Só o pagamento em dinheiro pode passar do total.');
    expect(isFullyPaid(result)).toBe(false);
  });
});

describe('cenário C: troco', () => {
  it('cliente entrega R$ 100,00 numa venda de R$ 50,00', () => {
    const result = computeCheckout(5000, [{ method: 'cash', amountCents: 10000 }], testFees);
    expect(result.changeCents).toBe(5000);
    expect(result.lines[0]!.coveredCents).toBe(5000);
    expect(result.lines[0]!.chargedCents).toBe(5000);
    expect(isFullyPaid(result)).toBe(true);
  });

  it('troco sai do dinheiro mesmo com pagamento misto', () => {
    const result = computeCheckout(
      15000,
      [
        { method: 'pix', amountCents: 10000 },
        { method: 'cash', amountCents: 10000 },
      ],
      testFees,
    );
    expect(result.changeCents).toBe(5000);
    expect(result.lines[1]!.coveredCents).toBe(5000);
  });
});

describe('cenário D: fechamento', () => {
  it('abertura, venda, sangria, custo da gaveta e contagem', () => {
    const sale = computeCheckout(5000, [{ method: 'cash', amountCents: 10000 }], testFees);
    const cart = computeCart([{ qty: 1, unitPriceCents: 5000, unitCostCents: 2000 }]);
    const movements: LedgerMovement[] = [
      ...paymentMovements(sale),
      { type: 'withdrawal', method: 'cash', amountCents: 3000, feeCents: 0, fromDrawer: true },
      { type: 'expense', method: 'cash', amountCents: 2000, feeCents: 0, fromDrawer: true },
    ];
    const expected = expectedCashCents(10000, movements);
    expect(expected).toBe(10000);
    const closing = closeCash(expected, 9500);
    expect(closing.differenceCents).toBe(-500);
    expect(closing.requiresNote).toBe(true);
    const summary = summarize({ movements, cmvCents: cart.costCents, salesCount: 1, salesTotalCents: cart.totalCents });
    expect(summary.resultCents).toBe(1000);
    expect(summary.withdrawalCents).toBe(3000);
    expect(expectedByMethod(10000, movements).cash).toBe(10000);
  });

  it('diferença zero não exige observação', () => {
    expect(closeCash(10000, 10000).requiresNote).toBe(false);
  });

  it('suprimento e custo fora da gaveta', () => {
    const movements: LedgerMovement[] = [
      { type: 'supply', method: 'cash', amountCents: 5000, feeCents: 0, fromDrawer: true },
      { type: 'expense', method: 'pix', amountCents: 4000, feeCents: 0, fromDrawer: false },
      { type: 'income', method: 'pix', amountCents: 2000, feeCents: 0, fromDrawer: false },
    ];
    expect(expectedCashCents(0, movements)).toBe(5000);
    const summary = summarize({ movements, cmvCents: 0, salesCount: 0, salesTotalCents: 0 });
    expect(summary.resultCents).toBe(-2000);
    expect(summary.supplyCents).toBe(5000);
  });
});

describe('cenário E: OS do início ao fim', () => {
  it('dia 1: sinal de R$ 50,00 no Pix', () => {
    const deposit = computeCheckout(5000, [{ method: 'pix', amountCents: 5000 }], testFees);
    expect(deposit.feeCents).toBe(50);
    const summary = summarize({ movements: paymentMovements(deposit), cmvCents: 0, salesCount: 0, salesTotalCents: 0 });
    expect(summary.resultCents).toBe(4950);
  });

  it('dia 2: Receber e entregar com R$ 200,00 no crédito 2x', () => {
    const cart = computeCart([
      { qty: 1, unitPriceCents: 15000, unitCostCents: 8000 },
      { qty: 1, unitPriceCents: 10000, unitCostCents: 0 },
    ]);
    expect(cart.totalCents).toBe(25000);
    const due = cart.totalCents - 5000;
    const payment = computeCheckout(due, [{ method: 'credit', amountCents: 20000, installments: 2 }], testFees);
    expect(payment.feeCents).toBe(898);
    expect(isFullyPaid(payment)).toBe(true);
    const summary = summarize({
      movements: paymentMovements(payment),
      cmvCents: cart.costCents,
      salesCount: 1,
      salesTotalCents: cart.totalCents,
    });
    expect(summary.resultCents).toBe(11102);
    expect(summary.salesTotalCents).toBe(25000);
  });
});

describe('cenário F: cancelamento', () => {
  it('estorno no mesmo dia devolve o resumo ao valor anterior', () => {
    const before = summarize({ movements: [], cmvCents: 0, salesCount: 0, salesTotalCents: 0 });
    const sale = computeCheckout(30000, [{ method: 'credit', amountCents: 30000, installments: 3 }], testFees);
    const paid = paymentMovements(sale);
    const reversal: LedgerMovement[] = paid.map((movement) => ({ ...movement, type: 'reversal' }));
    const after = summarize({ movements: [...paid, ...reversal], cmvCents: 12000 - 12000, salesCount: 0, salesTotalCents: 0 });
    expect(after.resultCents).toBe(before.resultCents);
    expect(after.feeCents).toBe(0);
    expect(after.receivedCents).toBe(0);
  });

  it('estorno em dinheiro tira da gaveta', () => {
    const movements: LedgerMovement[] = [
      { type: 'payment', method: 'cash', amountCents: 5000, feeCents: 0, fromDrawer: false },
      { type: 'reversal', method: 'cash', amountCents: 5000, feeCents: 0, fromDrawer: false },
    ];
    expect(expectedCashCents(10000, movements)).toBe(10000);
  });
});

describe('cenário G: repasse da taxa', () => {
  it('crédito 3x com repasse ao cliente', () => {
    const rule = findFeeRule(passThroughFees, 'credit', 3);
    expect(grossUpForCustomer(30000, rule)).toBe(31576);
    const charge = chargeFor(30000, rule);
    expect(charge.chargedCents).toBe(31576);
    expect(charge.feeCents).toBe(1576);
    expect(charge.netCents).toBe(30000);
    const result = computeCheckout(30000, [{ method: 'credit', amountCents: 30000, installments: 3 }], passThroughFees);
    expect(result.chargedCents).toBe(31576);
    expect(result.feeCents).toBe(1576);
    expect(result.netCents).toBe(30000);
    expect(result.remainingCents).toBe(0);
    const summary = summarize({ movements: paymentMovements(result), cmvCents: 0, salesCount: 1, salesTotalCents: 30000 });
    expect(summary.resultCents).toBe(30000);
  });

  it('simulador mostra o total cobrado com repasse', () => {
    const three = simulateInstallments(30000, passThroughFees).find((option) => option.installments === 3)!;
    expect(three.chargedCents).toBe(31576);
    expect(three.netCents).toBe(30000);
  });

  it('repasse com taxa fixa garante o valor cheio', () => {
    const rule = { percentBps: 499, fixedCents: 50 };
    const charged = grossUpForCustomer(30000, rule);
    expect(charged - computeFee(charged, rule)).toBeGreaterThanOrEqual(30000);
  });
});

describe('cenário H: saldo pendente', () => {
  it('recebe R$ 100,00 de R$ 250,00', () => {
    const result = computeCheckout(25000, [{ method: 'cash', amountCents: 10000 }], testFees);
    expect(result.coveredCents).toBe(10000);
    expect(result.remainingCents).toBe(15000);
    expect(isFullyPaid(result)).toBe(false);
    expect(result.errors).toHaveLength(0);
  });
});

describe('carrinho e descontos', () => {
  it('desconto por item e no total', () => {
    const cart = computeCart(
      [
        { qty: 2, unitPriceCents: 5000, discount: { mode: 'percent', value: 1000 } },
        { qty: 1, unitPriceCents: 3000, discount: { mode: 'amount', value: 500 } },
      ],
      { mode: 'amount', value: 1000 },
    );
    expect(cart.items[0]!.totalCents).toBe(9000);
    expect(cart.items[1]!.totalCents).toBe(2500);
    expect(cart.subtotalCents).toBe(11500);
    expect(cart.totalCents).toBe(10500);
    expect(cart.discountCents).toBe(2500);
    expect(cart.effectiveDiscountBps).toBe(1924);
  });

  it('desconto nunca passa do valor', () => {
    const cart = computeCart([{ qty: 1, unitPriceCents: 1000, discount: { mode: 'amount', value: 5000 } }]);
    expect(cart.totalCents).toBe(0);
  });

  it('custo médio ponderado', () => {
    expect(weightedAverageCost(10, 1000, 10, 2000)).toBe(1500);
    expect(weightedAverageCost(0, 1000, 5, 2000)).toBe(2000);
    expect(weightedAverageCost(-2, 1000, 5, 2000)).toBe(2000);
  });
});
