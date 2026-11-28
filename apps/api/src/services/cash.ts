import { expectedByMethod, type LedgerMovement, type PaymentLine } from '@loja/shared';
import type { CashMovement, CashSession, Payment } from '../generated/prisma/client.ts';
import type { Tx } from '../db.ts';
import { AppError } from '../lib/errors.ts';

const SESSION_LOCK_KEY = 4720261;

export const cashClosedError = () => new AppError(409, 'O caixa está fechado. Abra o caixa para continuar.', 'CASH_CLOSED');

export async function lockSessionSlot(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SESSION_LOCK_KEY})`;
}

export async function findOpenSession(tx: Tx) {
  return tx.cashSession.findFirst({ where: { status: 'open' }, orderBy: { openedAt: 'desc' } });
}

export async function requireOpenSession(tx: Tx, mode: 'share' | 'update' = 'share'): Promise<CashSession> {
  const rows =
    mode === 'update'
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "CashSession" WHERE status = 'open' ORDER BY "openedAt" DESC LIMIT 1 FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "CashSession" WHERE status = 'open' ORDER BY "openedAt" DESC LIMIT 1 FOR SHARE`;
  const id = rows[0]?.id;
  if (!id) throw cashClosedError();
  const session = await tx.cashSession.findUnique({ where: { id } });
  if (!session || session.status !== 'open') throw cashClosedError();
  return session;
}

export function toLedger(movement: Pick<CashMovement, 'type' | 'method' | 'amountCents' | 'feeCents' | 'fromDrawer'>): LedgerMovement {
  return {
    type: movement.type,
    method: movement.method,
    amountCents: movement.amountCents,
    feeCents: movement.feeCents,
    fromDrawer: movement.fromDrawer,
  };
}

export async function sessionExpected(tx: Tx, session: Pick<CashSession, 'id' | 'openingCents'>) {
  const movements = await tx.cashMovement.findMany({ where: { sessionId: session.id }, orderBy: { occurredAt: 'asc' } });
  const expected = expectedByMethod(session.openingCents, movements.map(toLedger));
  return { movements, expected };
}

export interface PaymentRef {
  type: 'Sale' | 'ServiceOrder';
  id: string;
  number: string | null;
}

export interface RecordPaymentsInput {
  session: Pick<CashSession, 'id'>;
  lines: PaymentLine[];
  saleId?: string | null;
  serviceOrderId?: string | null;
  userId: string;
  approvedById?: string | null;
  now: Date;
  ref: PaymentRef;
  description: string;
}

export async function recordPayments(tx: Tx, input: RecordPaymentsInput): Promise<Payment[]> {
  const created: Payment[] = [];
  for (const line of input.lines) {
    const payment = await tx.payment.create({
      data: {
        saleId: input.saleId ?? null,
        serviceOrderId: input.serviceOrderId ?? null,
        cashSessionId: input.session.id,
        method: line.method,
        installments: line.installments,
        amountCents: line.chargedCents,
        coveredCents: line.coveredCents,
        surchargeCents: line.surchargeCents,
        feeCents: line.feeCents,
        feePercentBps: line.feePercentBps,
        changeCents: line.changeCents,
        receivedAt: input.now,
        receivedById: input.userId,
      },
    });
    await tx.cashMovement.create({
      data: {
        sessionId: input.session.id,
        type: 'payment',
        method: line.method,
        amountCents: line.chargedCents,
        feeCents: line.feeCents,
        fromDrawer: line.method === 'cash',
        description: input.description,
        refType: input.ref.type,
        refId: input.ref.id,
        refNumber: input.ref.number,
        paymentId: payment.id,
        userId: input.userId,
        approvedById: input.approvedById ?? null,
        occurredAt: input.now,
      },
    });
    created.push(payment);
  }
  return created;
}

export interface ReversePaymentsInput {
  session: Pick<CashSession, 'id'>;
  payments: Payment[];
  userId: string;
  approvedById?: string | null;
  now: Date;
  ref: PaymentRef;
  description: string;
}

export async function reversePayments(tx: Tx, input: ReversePaymentsInput) {
  let amountCents = 0;
  let feeCents = 0;
  for (const payment of input.payments) {
    if (payment.reversedAt) continue;
    await tx.payment.update({ where: { id: payment.id }, data: { reversedAt: input.now } });
    await tx.cashMovement.create({
      data: {
        sessionId: input.session.id,
        type: 'reversal',
        method: payment.method,
        amountCents: payment.amountCents,
        feeCents: payment.feeCents,
        fromDrawer: payment.method === 'cash',
        description: input.description,
        refType: input.ref.type,
        refId: input.ref.id,
        refNumber: input.ref.number,
        paymentId: payment.id,
        userId: input.userId,
        approvedById: input.approvedById ?? null,
        occurredAt: input.now,
      },
    });
    amountCents += payment.amountCents;
    feeCents += payment.feeCents;
  }
  return { amountCents, feeCents };
}
