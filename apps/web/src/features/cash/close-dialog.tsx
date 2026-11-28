import { closeCash, formatMoney, PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@loja/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Textarea } from '@/components/ui/input.tsx';
import { MoneyInput } from '@/components/ui/masked.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import { useToast } from '@/lib/toast.tsx';
import type { CashSessionView } from '@/lib/types.ts';
import { cn } from '@/lib/utils.ts';
import { invalidateMoney } from './queries.ts';

export function CloseCashDialog({
  session,
  open,
  onOpenChange,
  onClosed,
}: {
  session: CashSessionView;
  open: boolean;
  onOpenChange(open: boolean): void;
  onClosed(sessionId: string): void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [counted, setCounted] = useState(0);
  const [touched, setTouched] = useState(false);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCounted(0);
    setTouched(false);
    setNotes('');
    setErrors({});
  }, [open]);

  const closing = closeCash(session.expectedNow.cash, counted);
  const showDifference = touched;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!touched) {
      setErrors({ countedCashCents: 'Conte o dinheiro da gaveta e informe o valor.' });
      return;
    }
    if (closing.requiresNote && !notes.trim()) {
      setErrors({ notes: 'Explique a diferença entre o contado e o esperado.' });
      return;
    }
    setSaving(true);
    try {
      const closed = await api.post<CashSessionView>('/api/cash/close', { countedCashCents: counted, notes: notes.trim() || undefined });
      await invalidateMoney(queryClient);
      toast.success('Caixa fechado', closing.differenceCents === 0 ? 'Sem diferença.' : `Diferença de ${formatMoney(closing.differenceCents)}.`);
      onOpenChange(false);
      onClosed(closed.id);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION') setErrors(error.fieldErrors());
      else toast.error('Não foi possível fechar o caixa', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        title="Fechar caixa"
        description="Confira os valores esperados e conte o dinheiro da gaveta."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" form="cash-close-form" loading={saving}>
              Fechar caixa
            </Button>
          </>
        }
      >
        <form id="cash-close-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <table className="w-full text-sm">
            <caption className="sr-only">Esperado por forma de pagamento</caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 font-medium">Forma</th>
                <th className="py-1 text-right font-medium">Esperado</th>
              </tr>
            </thead>
            <tbody>
              {PAYMENT_METHODS.map((method) => (
                <tr key={method} className="border-t border-border">
                  <td className="py-1.5">{method === 'cash' ? 'Dinheiro na gaveta' : PAYMENT_METHOD_LABELS[method]}</td>
                  <td className="num py-1.5 text-right">{formatMoney(session.expectedNow[method])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="-mt-2 text-xs text-muted">Pix e cartões são conferidos no extrato da maquininha e do banco. Só o dinheiro é contado aqui.</p>
          <Field label="Dinheiro contado na gaveta" required error={errors.countedCashCents}>
            <MoneyInput
              value={counted}
              onValueChange={(value) => {
                setCounted(value);
                setTouched(true);
                setErrors({});
              }}
              autoFocus
            />
          </Field>
          {showDifference && (
            <div
              role="status"
              className={cn(
                'flex items-center justify-between rounded-md border px-3 py-2 text-sm',
                closing.differenceCents === 0 ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning',
              )}
            >
              <span>{closing.differenceCents === 0 ? 'Bateu certinho' : closing.differenceCents > 0 ? 'Sobra' : 'Falta'}</span>
              <span className="num font-semibold">{formatMoney(closing.differenceCents)}</span>
            </div>
          )}
          <Field label="Observação" required={closing.requiresNote && touched} error={errors.notes} hint={closing.requiresNote && touched ? 'Obrigatória quando há diferença.' : undefined}>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={500} />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
