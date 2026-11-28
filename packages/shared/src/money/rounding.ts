export function assertInteger(value: number, label = 'valor'): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} precisa ser um inteiro em centavos`);
  }
}

export function divRoundHalfUp(numerator: number, denominator: number): number {
  assertInteger(numerator, 'numerador');
  assertInteger(denominator, 'denominador');
  if (denominator === 0) throw new Error('Divisão por zero');
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const quotient = Math.floor(n / d);
  const remainder = n - quotient * d;
  const rounded = remainder * 2 >= d ? quotient + 1 : quotient;
  return sign < 0 ? -rounded : rounded;
}

export function percentOfBps(amountCents: number, bps: number): number {
  assertInteger(amountCents);
  assertInteger(bps, 'percentual');
  return divRoundHalfUp(amountCents * bps, 10000);
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
