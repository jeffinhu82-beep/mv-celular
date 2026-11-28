import { formatDateTime, formatMoney, formatTime, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PrintSize } from '@loja/shared';
import type { CashSessionView, StoreSettings } from '@/lib/types.ts';
import { cn } from '@/lib/utils.ts';
import { PRINT_WIDTHS } from '@/features/print/print.tsx';
import { movementLabel, signedAmount, totalsByType } from './shared.ts';

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-2', strong && 'font-bold')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function CashReport({ session, settings, size }: { session: CashSessionView; settings: StoreSettings | undefined; size: PrintSize }) {
  const narrow = size !== 'A4';
  const expected = session.status === 'closed' && session.expected ? session.expected : session.expectedNow;
  const totals = totalsByType(session.movements);
  return (
    <div className={cn('font-sans text-black', narrow ? 'text-[11px] leading-snug' : 'text-[13px] leading-normal', PRINT_WIDTHS[size])}>
      <div className="border-b border-dashed border-black pb-2 text-center">
        <p className="text-[1.15em] font-bold">{settings?.name}</p>
        <p className="font-bold">RELATÓRIO DE CAIXA</p>
        <p>{session.status === 'closed' ? 'Fechado' : 'Parcial (caixa aberto)'}</p>
      </div>
      <div className="border-b border-dashed border-black py-2">
        <Line label="Abertura" value={formatDateTime(session.openedAt)} />
        <Line label="Aberto por" value={session.openedByName} />
        {session.closedAt && <Line label="Fechamento" value={formatDateTime(session.closedAt)} />}
        {session.closedByName && <Line label="Fechado por" value={session.closedByName} />}
        {session.reopenedAt && <p className="mt-1">Reaberto em {formatDateTime(session.reopenedAt)} por {session.reopenedByName}: {session.reopenReason}</p>}
      </div>
      <div className="border-b border-dashed border-black py-2">
        <Line label="Valor de abertura" value={formatMoney(session.openingCents)} />
        <Line label="Recebimentos" value={formatMoney(totals.payment)} />
        <Line label="Entradas avulsas" value={formatMoney(totals.income)} />
        <Line label="Suprimentos" value={formatMoney(totals.supply)} />
        <Line label="Sangrias" value={formatMoney(-totals.withdrawal)} />
        <Line label="Custos" value={formatMoney(-totals.expense)} />
        {totals.reversal > 0 && <Line label="Estornos" value={formatMoney(-totals.reversal)} />}
      </div>
      <div className="border-b border-dashed border-black py-2">
        <p className="font-semibold">Esperado por forma</p>
        {PAYMENT_METHODS.map((method) => (
          <Line key={method} label={method === 'cash' ? 'Dinheiro na gaveta' : PAYMENT_METHOD_LABELS[method]} value={formatMoney(expected[method])} />
        ))}
      </div>
      {session.status === 'closed' && (
        <div className="border-b border-dashed border-black py-2">
          <Line label="Dinheiro contado" value={formatMoney(session.countedCashCents)} />
          <Line
            label={session.differenceCents === 0 ? 'Diferença' : (session.differenceCents ?? 0) > 0 ? 'Sobra' : 'Falta'}
            value={formatMoney(session.differenceCents)}
            strong
          />
          {session.notes && <p className="mt-1">Obs.: {session.notes}</p>}
        </div>
      )}
      <div className="py-2">
        <p className="font-semibold">Movimentações ({session.movements.length})</p>
        {session.movements.map((movement) => (
          <div key={movement.id} className="flex justify-between gap-2">
            <span className="min-w-0">
              {formatTime(movement.occurredAt)} {movementLabel(movement)}
              {movement.refNumber ? ` ${movement.refNumber}` : ''} · {PAYMENT_METHOD_LABELS[movement.method]}
              {!narrow && movement.description ? ` · ${movement.description}` : ''}
            </span>
            <span className="tabular-nums">{formatMoney(signedAmount(movement))}</span>
          </div>
        ))}
      </div>
      {session.status === 'closed' && (
        <div className="mt-6 grid grid-cols-1 gap-6">
          <div className="border-t border-black pt-1 text-center">Assinatura de quem fechou</div>
        </div>
      )}
    </div>
  );
}
