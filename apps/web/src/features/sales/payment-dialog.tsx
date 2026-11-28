import {
  computeCheckout,
  formatBps,
  formatMoney,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  simulateInstallments,
  type FeeConfig,
  type PaymentInput,
  type PaymentLine as CheckoutLine,
  type PaymentMethod,
} from '@loja/shared';
import { AlertTriangle, Banknote, Calculator, CheckCircle2, CreditCard, Landmark, Plus, QrCode, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { CheckboxField } from '@/components/ui/controls.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { NativeSelect } from '@/components/ui/input.tsx';
import { MoneyInput } from '@/components/ui/masked.tsx';
import { Skeleton } from '@/components/ui/misc.tsx';
import { useAuth } from '@/lib/auth.tsx';
import { cn } from '@/lib/utils.ts';
import { useFeeConfig } from './fees.ts';

const METHOD_ICONS = { cash: Banknote, pix: QrCode, debit: Landmark, credit: CreditCard } as const;

interface DraftPayment {
  key: number;
  method: PaymentMethod;
  amountCents: number;
  installments: number;
}

export interface PaymentSubmit {
  payments: PaymentInput[];
  allowPending: boolean;
}

export function PaymentDialog({
  open,
  onOpenChange,
  dueCents,
  hasCustomer,
  title = 'Pagamento',
  confirmLabel = 'Confirmar pagamento',
  pendingAllowed = true,
  partial = false,
  dueLabel = 'Total da venda',
  description,
  summary,
  onSubmit,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  dueCents: number;
  hasCustomer: boolean;
  title?: string;
  confirmLabel?: string;
  pendingAllowed?: boolean;
  partial?: boolean;
  dueLabel?: string;
  description?: string;
  summary?: ReactNode;
  onSubmit(input: PaymentSubmit): Promise<void>;
}) {
  const { can } = useAuth();
  const fees = useFeeConfig();
  const showFees = can('finance.view');
  const [payments, setPayments] = useState<DraftPayment[]>([]);
  const [allowPending, setAllowPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const keyRef = useRef(0);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const [focusKey, setFocusKey] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setPayments([]);
    setAllowPending(false);
  }, [open]);

  useEffect(() => {
    if (focusKey === null) return;
    const element = inputs.current.get(focusKey);
    if (element) {
      element.focus();
      element.select();
    }
    setFocusKey(null);
  }, [focusKey, payments]);

  const config = fees.data;
  const positive = useMemo(() => payments.filter((payment) => payment.amountCents > 0), [payments]);
  const checkout = useMemo(
    () =>
      config
        ? computeCheckout(
            dueCents,
            positive.map((payment) => ({ method: payment.method, amountCents: payment.amountCents, installments: payment.installments })),
            config,
          )
        : null,
    [config, dueCents, positive],
  );

  const add = (method: PaymentMethod) => {
    const remaining = checkout ? checkout.remainingCents : dueCents;
    keyRef.current += 1;
    const key = keyRef.current;
    setPayments((current) => [...current, { key, method, amountCents: remaining, installments: 1 }]);
    setFocusKey(key);
  };

  const update = (key: number, patch: Partial<DraftPayment>) =>
    setPayments((current) => current.map((payment) => (payment.key === key ? { ...payment, ...patch } : payment)));

  const remove = (key: number) => setPayments((current) => current.filter((payment) => payment.key !== key));

  const remaining = checkout?.remainingCents ?? dueCents;
  const pendingOk = allowPending && hasCustomer && pendingAllowed;
  const blocking = checkout?.errors ?? [];
  const settled = partial ? (checkout?.coveredCents ?? 0) > 0 : remaining === 0 || pendingOk;
  const canConfirm = Boolean(checkout) && blocking.length === 0 && settled && !saving;
  const surchargeCents = checkout?.lines.reduce((total, line) => total + line.surchargeCents, 0) ?? 0;

  const confirm = async () => {
    if (!canConfirm) return;
    setSaving(true);
    try {
      await onSubmit({
        payments: positive.map((payment) => ({
          method: payment.method,
          amountCents: payment.amountCents,
          ...(payment.method === 'credit' ? { installments: payment.installments } : {}),
        })),
        allowPending: !partial && remaining > 0 && pendingOk,
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmOnEnter = (event: React.KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void confirm();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="xl"
        title={title}
        description={description}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        onKeyDown={(event) => {
          if (event.key === 'F10') {
            event.preventDefault();
            void confirm();
          }
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Voltar
            </Button>
            <Button variant="primary" onClick={() => void confirm()} disabled={!canConfirm} loading={saving}>
              {confirmLabel} <kbd className="ml-1 hidden rounded bg-black/20 px-1 text-[10px] sm:inline">F10</kbd>
            </Button>
          </>
        }
      >
        {!config || !checkout ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="grid gap-5 md:grid-cols-[1fr_16rem]">
            <div className="flex min-w-0 flex-col gap-4">
              {summary}
              {dueCents === 0 && payments.length === 0 ? (
                <p className="rounded-lg bg-surface-2 px-4 py-6 text-center text-sm text-muted">Não há saldo a receber. É só confirmar.</p>
              ) : payments.length === 0 ? (
                <MethodPicker onPick={add} />
              ) : (
                <>
                  <ul className="flex flex-col gap-2" aria-label="Formas de pagamento">
                    {payments.map((payment) => (
                      <PaymentLine
                        key={payment.key}
                        payment={payment}
                        line={checkout.lines[positive.findIndex((entry) => entry.key === payment.key)]}
                        config={config}
                        showFees={showFees}
                        removeLabel={removeLabel(payments, payment)}
                        inputRef={(element) => {
                          if (element) inputs.current.set(payment.key, element);
                          else inputs.current.delete(payment.key);
                        }}
                        onChange={(patch) => update(payment.key, patch)}
                        onRemove={() => remove(payment.key)}
                        onEnter={confirmOnEnter}
                      />
                    ))}
                  </ul>
                  {remaining > 0 ? (
                    <div role="group" aria-labelledby="payment-add-heading">
                      <p id="payment-add-heading" className="mb-2 text-xs text-muted">
                        {partial ? 'Somar outra forma' : 'Pagar o restante com'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {PAYMENT_METHODS.map((method) => (
                          <Button key={method} size="sm" variant="outline" onClick={() => add(method)}>
                            <Plus aria-hidden className="text-muted" />
                            {PAYMENT_METHOD_LABELS[method]}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted">{partial ? 'Esse valor quita todo o saldo. Para um sinal menor, diminua o valor.' : 'Para dividir em outra forma, diminua o valor de uma delas.'}</p>
                  )}
                </>
              )}
            </div>

            <aside aria-label="Resumo do pagamento" className="order-first flex flex-col gap-3 md:order-none">
              <div className="rounded-lg bg-surface-2 p-4">
                <p className="text-sm text-muted">{dueLabel}</p>
                <p className="num mt-0.5 text-3xl font-semibold tracking-tight">{formatMoney(dueCents)}</p>
                {dueCents > 0 && (
                  <dl className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted">Pago</dt>
                      <dd className="num">{formatMoney(checkout.coveredCents)}</dd>
                    </div>
                    {surchargeCents > 0 && (
                      <>
                        <div className="flex justify-between">
                          <dt className="text-muted">Acréscimo do cartão</dt>
                          <dd className="num">{formatMoney(surchargeCents)}</dd>
                        </div>
                        <div className="flex justify-between font-medium">
                          <dt>Cliente paga</dt>
                          <dd className="num">{formatMoney(checkout.coveredCents + surchargeCents)}</dd>
                        </div>
                      </>
                    )}
                  </dl>
                )}
                <div aria-live="polite" className="mt-3">
                  <PaymentStatus partial={partial} remainingCents={remaining} changeCents={checkout.changeCents} started={payments.length > 0 || dueCents === 0} settledBefore={dueCents === 0} />
                </div>
                {showFees && checkout.coveredCents > 0 && (
                  <dl className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-xs">
                    <div className="flex justify-between text-muted">
                      <dt>Taxas das maquininhas</dt>
                      <dd className="num">{checkout.feeCents > 0 ? `−${formatMoney(checkout.feeCents)}` : formatMoney(0)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Líquido para a loja</dt>
                      <dd className="num font-medium">{formatMoney(checkout.netCents)}</dd>
                    </div>
                  </dl>
                )}
              </div>


              {blocking.map((error) => (
                <p key={error} role="alert" className="flex gap-2 text-xs text-warning">
                  <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
                  {error}
                </p>
              ))}

              {remaining > 0 && payments.length > 0 && pendingAllowed && !partial && (
                <div className="rounded-lg border border-border p-3">
                  <CheckboxField
                    label="Deixar o restante a receber"
                    description={
                      hasCustomer
                        ? can('sale.allow_pending')
                          ? `${formatMoney(remaining)} fica em A receber.`
                          : 'Precisa de autorização.'
                        : 'Escolha o cliente da venda para deixar saldo.'
                    }
                    checked={allowPending}
                    disabled={!hasCustomer}
                    onCheckedChange={(checked) => setAllowPending(checked === true)}
                  />
                </div>
              )}
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function removeLabel(payments: DraftPayment[], payment: DraftPayment) {
  const label = PAYMENT_METHOD_LABELS[payment.method];
  const same = payments.filter((entry) => entry.method === payment.method);
  return same.length > 1 ? `Remover ${label} ${same.indexOf(payment) + 1}` : `Remover ${label}`;
}

function MethodPicker({ onPick }: { onPick(method: PaymentMethod): void }) {
  return (
    <section aria-labelledby="payment-method-heading">
      <h3 id="payment-method-heading" className="text-sm font-medium">
        Como o cliente vai pagar?
      </h3>
      <p className="mt-0.5 text-xs text-muted">Dá para combinar mais de uma forma depois.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PAYMENT_METHODS.map((method) => {
          const Icon = METHOD_ICONS[method];
          return (
            <Button key={method} variant="secondary" className="h-20 flex-col gap-2 hover:border-muted/60 [&_svg]:size-6" onClick={() => onPick(method)}>
              <Icon aria-hidden className="text-muted" />
              {PAYMENT_METHOD_LABELS[method]}
            </Button>
          );
        })}
      </div>
    </section>
  );
}

function PaymentStatus({ partial, remainingCents, changeCents, started, settledBefore }: { partial: boolean; remainingCents: number; changeCents: number; started: boolean; settledBefore: boolean }) {
  if (changeCents > 0) {
    return (
      <div className="flex items-baseline justify-between rounded-md bg-success/10 px-3 py-2.5 text-success">
        <span className="text-sm font-semibold">Troco</span>
        <span className="num text-2xl font-bold">{formatMoney(changeCents)}</span>
      </div>
    );
  }
  if (partial && remainingCents > 0) {
    return (
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted">Fica para a entrega</span>
        <span className="num font-semibold">{formatMoney(remainingCents)}</span>
      </div>
    );
  }
  if (remainingCents > 0) {
    return (
      <div className={cn('flex items-baseline justify-between rounded-md px-3 py-2.5', started ? 'bg-warning/10 text-warning' : 'bg-surface-3 text-text')}>
        <span className="text-sm font-semibold">Falta pagar</span>
        <span className="num text-lg font-semibold">{formatMoney(remainingCents)}</span>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2.5 text-sm font-semibold text-success">
      <CheckCircle2 aria-hidden className="size-4" /> {settledBefore ? 'Já está tudo pago' : 'Pagamento completo'}
    </p>
  );
}

function PaymentLine({
  payment,
  line,
  config,
  showFees,
  removeLabel,
  inputRef,
  onChange,
  onRemove,
  onEnter,
}: {
  payment: DraftPayment;
  line: CheckoutLine | undefined;
  config: FeeConfig;
  showFees: boolean;
  removeLabel: string;
  inputRef(element: HTMLInputElement | null): void;
  onChange(patch: Partial<DraftPayment>): void;
  onRemove(): void;
  onEnter(event: React.KeyboardEvent): void;
}) {
  const [simulating, setSimulating] = useState(false);
  const Icon = METHOD_ICONS[payment.method];
  const isCredit = payment.method === 'credit';
  const options = isCredit ? simulateInstallments(Math.max(payment.amountCents, 0), config) : [];

  return (
    <li className="rounded-lg border border-border bg-surface-2/50 p-3">
      <div className="flex items-center gap-2">
        <Icon aria-hidden className="size-4 text-muted" />
        <span className="text-sm font-medium">{PAYMENT_METHOD_LABELS[payment.method]}</span>
        <Button variant="ghost" size="icon-sm" className="-my-1 ml-auto text-muted hover:text-text" aria-label={removeLabel} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
      <div className={cn('mt-2 grid gap-2', isCredit && 'sm:grid-cols-2')}>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {payment.method === 'cash' ? 'Valor entregue pelo cliente' : 'Valor desta forma'}
          <MoneyInput ref={inputRef} value={payment.amountCents} onValueChange={(value) => onChange({ amountCents: value })} onKeyDown={onEnter} />
        </label>
        {isCredit && (
          <label className="flex flex-col gap-1 text-xs text-muted">
            Parcelas
            <NativeSelect value={payment.installments} onChange={(event) => onChange({ installments: Number(event.target.value) })}>
              {options.map((option) => (
                <option key={option.installments} value={option.installments} disabled={!option.allowed}>
                  {option.installments}x de {formatMoney(option.installmentCents)}
                  {option.chargedCents > payment.amountCents ? ' (com acréscimo)' : ''}
                  {!option.allowed ? ' (abaixo do mínimo)' : ''}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
      </div>

      {line && (line.surchargeCents > 0 || (showFees && line.feeCents > 0)) && (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {line.surchargeCents > 0 && (
            <span>
              Cliente paga <span className="num font-medium text-text">{formatMoney(line.chargedCents)}</span> (acréscimo de {formatMoney(line.surchargeCents)})
            </span>
          )}
          {showFees && line.feeCents > 0 && (
            <span>
              Taxa {formatBps(line.feePercentBps)}: {formatMoney(line.feeCents)}
            </span>
          )}
        </p>
      )}

      {isCredit && payment.amountCents > 0 && (
        <div className="mt-2">
          <Button variant="ghost" size="sm" className="-ml-2 h-7 px-2 text-xs text-muted hover:text-text" aria-expanded={simulating} onClick={() => setSimulating(!simulating)}>
            <Calculator aria-hidden className="size-3.5" />
            {simulating ? 'Esconder parcelas' : 'Comparar de 1x a 12x'}
          </Button>
          {simulating && (
            <table className="mt-1 w-full text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 text-left font-medium">Parcelas</th>
                  <th className="py-1 text-right font-medium">Parcela</th>
                  <th className="py-1 text-right font-medium">Cliente paga</th>
                  {showFees && <th className="py-1 text-right font-medium">Taxa</th>}
                  {showFees && <th className="py-1 text-right font-medium">Líquido</th>}
                </tr>
              </thead>
              <tbody>
                {options.map((option) => (
                  <tr
                    key={option.installments}
                    onClick={() => option.allowed && onChange({ installments: option.installments })}
                    className={cn(
                      'border-t border-border',
                      option.allowed ? 'cursor-pointer hover:bg-surface-3' : 'opacity-40',
                      option.installments === payment.installments && 'bg-surface-3 font-medium text-text',
                    )}
                  >
                    <td className="py-1">{option.installments}x</td>
                    <td className="num py-1 text-right">{formatMoney(option.installmentCents)}</td>
                    <td className="num py-1 text-right">{formatMoney(option.chargedCents)}</td>
                    {showFees && <td className="num py-1 text-right">{formatMoney(option.feeCents)}</td>}
                    {showFees && <td className="num py-1 text-right">{formatMoney(option.netCents)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </li>
  );
}
