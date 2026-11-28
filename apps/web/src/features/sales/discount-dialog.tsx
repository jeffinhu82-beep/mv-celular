import { formatMoney, resolveDiscount, type DiscountInput } from '@loja/shared';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { MoneyInput, PercentInput } from '@/components/ui/masked.tsx';
import { cn } from '@/lib/utils.ts';

export function DiscountDialog({
  open,
  onOpenChange,
  title,
  baseCents,
  value,
  limitBps,
  onApply,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  baseCents: number;
  value: DiscountInput | undefined;
  limitBps: number;
  onApply(discount: DiscountInput | undefined): void;
}) {
  const [mode, setMode] = useState<DiscountInput['mode']>('amount');
  const [amount, setAmount] = useState(0);
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    if (!open) return;
    setMode(value?.mode ?? 'amount');
    setAmount(value?.mode === 'amount' ? value.value : 0);
    setPercent(value?.mode === 'percent' ? value.value : 0);
  }, [open, value]);

  const discount: DiscountInput = mode === 'amount' ? { mode, value: Math.min(amount, baseCents) } : { mode, value: percent };
  const resolved = resolveDiscount(baseCents, discount);
  const bps = baseCents > 0 ? Math.ceil((resolved * 10000) / baseCents) : 0;

  const apply = (event?: React.FormEvent) => {
    event?.preventDefault();
    onApply(resolved > 0 ? discount : undefined);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title={title}
        description={`Sobre ${formatMoney(baseCents)}.`}
        footer={
          <>
            {value && (
              <Button
                variant="ghost"
                onClick={() => {
                  onApply(undefined);
                  onOpenChange(false);
                }}
              >
                Remover desconto
              </Button>
            )}
            <Button variant="primary" type="submit" form="discount-form">
              Aplicar
            </Button>
          </>
        }
      >
        <form id="discount-form" onSubmit={apply} className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="Tipo de desconto" className="inline-flex self-start rounded-md border border-border p-0.5">
            {(
              [
                ['amount', 'Valor (R$)'],
                ['percent', 'Percentual (%)'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={mode === key}
                onClick={() => setMode(key)}
                className={cn('rounded px-3 py-1 text-sm', mode === key ? 'bg-surface-3 font-medium text-text' : 'text-muted hover:text-text')}
              >
                {label}
              </button>
            ))}
          </div>
          <Field label="Desconto">
            {mode === 'amount' ? (
              <MoneyInput value={amount} onValueChange={setAmount} max={baseCents} autoFocus />
            ) : (
              <PercentInput value={percent} onValueChange={setPercent} autoFocus />
            )}
          </Field>
          <div className="rounded-md bg-surface-2 px-3 py-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Desconto</span>
              <span className="num">−{formatMoney(resolved)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>Fica</span>
              <span className="num">{formatMoney(baseCents - resolved)}</span>
            </div>
          </div>
          {bps > limitBps && (
            <p className="text-xs text-warning">Passa do seu limite de desconto. Ao finalizar, alguém com permissão vai precisar autorizar.</p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
