import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod } from '@loja/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { SwitchField } from '@/components/ui/controls.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input, NativeSelect } from '@/components/ui/input.tsx';
import { MoneyInput } from '@/components/ui/masked.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import { useToast } from '@/lib/toast.tsx';
import type { ExpenseCategory } from '@/lib/types.ts';
import { invalidateMoney } from './queries.ts';

export type MovementKind = 'entry' | 'withdrawal' | 'expense';

const COPY: Record<MovementKind, { title: string; description: string; submit: string; done: string; url: string }> = {
  entry: {
    title: 'Entrada avulsa',
    description: 'Receita fora de venda (entra no resultado) ou suprimento de troco (só reforça a gaveta).',
    submit: 'Registrar entrada',
    done: 'Entrada registrada',
    url: '/api/cash/entries',
  },
  withdrawal: {
    title: 'Sangria',
    description: 'Dinheiro retirado da gaveta (ex.: levar para o cofre). Não é custo.',
    submit: 'Registrar sangria',
    done: 'Sangria registrada',
    url: '/api/cash/withdrawals',
  },
  expense: {
    title: 'Registrar custo',
    description: 'Despesa da loja. Entra no resultado do dia.',
    submit: 'Registrar custo',
    done: 'Custo registrado',
    url: '/api/cash/expenses',
  },
};

export function MovementDialog({ kind, onOpenChange }: { kind: MovementKind | null; onOpenChange(open: boolean): void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [entryType, setEntryType] = useState<'income' | 'supply'>('income');
  const [amountCents, setAmountCents] = useState(0);
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [categoryId, setCategoryId] = useState('');
  const [fromDrawer, setFromDrawer] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const categories = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api.get<ExpenseCategory[]>('/api/expense-categories'),
    enabled: kind === 'expense',
  });

  useEffect(() => {
    if (!kind) return;
    setEntryType('income');
    setAmountCents(0);
    setDescription('');
    setMethod('cash');
    setCategoryId('');
    setFromDrawer(true);
    setErrors({});
  }, [kind]);

  if (!kind) return null;
  const copy = COPY[kind];
  const type = kind === 'entry' ? entryType : kind;
  const cashOnly = type === 'supply' || type === 'withdrawal';
  const effectiveMethod = cashOnly ? 'cash' : method;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (amountCents <= 0) local.amountCents = 'Informe o valor.';
    if (!description.trim()) local.description = 'Descreva a movimentação.';
    if (type === 'expense' && !categoryId) local.categoryId = 'Escolha a categoria do custo.';
    setErrors(local);
    if (Object.keys(local).length > 0) return;
    setSaving(true);
    try {
      await api.post(copy.url, {
        type,
        amountCents,
        description: description.trim(),
        method: effectiveMethod,
        ...(type === 'expense' ? { categoryId, fromDrawer: effectiveMethod === 'cash' && fromDrawer } : {}),
      });
      await invalidateMoney(queryClient);
      toast.success(copy.done);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'APPROVAL_CANCELLED') return;
      if (error instanceof ApiError && error.code === 'VALIDATION') setErrors(error.fieldErrors());
      else toast.error('Não foi possível registrar', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title={copy.title}
        description={copy.description}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" form="cash-movement-form" loading={saving}>
              {copy.submit}
            </Button>
          </>
        }
      >
        <form id="cash-movement-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {kind === 'entry' && (
            <div role="radiogroup" aria-label="Tipo de entrada" className="grid grid-cols-2 gap-2">
              {(
                [
                  ['income', 'Receita', 'Entra no resultado'],
                  ['supply', 'Suprimento', 'Troco para a gaveta'],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={entryType === value}
                  onClick={() => setEntryType(value)}
                  className={`rounded-md border px-3 py-2 text-left ${entryType === value ? 'border-primary bg-primary/10' : 'border-border hover:bg-surface-2'}`}
                >
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </button>
              ))}
            </div>
          )}
          <Field label="Valor" required error={errors.amountCents}>
            <MoneyInput value={amountCents} onValueChange={setAmountCents} autoFocus />
          </Field>
          {kind === 'expense' && (
            <Field label="Categoria" required error={errors.categoryId}>
              <NativeSelect value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">Escolha…</option>
                {(categories.data ?? [])
                  .filter((category) => category.active)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Descrição" required error={errors.description}>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={300}
              placeholder={kind === 'withdrawal' ? 'Ex.: levar para o cofre' : kind === 'expense' ? 'Ex.: café e água' : 'Ex.: venda de sucata'}
            />
          </Field>
          {!cashOnly && (
            <Field label="Forma" error={errors.method}>
              <NativeSelect value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
                {PAYMENT_METHODS.map((value) => (
                  <option key={value} value={value}>
                    {PAYMENT_METHOD_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {kind === 'expense' && effectiveMethod === 'cash' && (
            <SwitchField
              label="Saiu da gaveta"
              description="Desligue se o dinheiro saiu do cofre ou do bolso, e não da gaveta deste caixa."
              checked={fromDrawer}
              onCheckedChange={setFromDrawer}
            />
          )}
          {cashOnly && <p className="text-xs text-muted">Sempre em dinheiro, mexe na gaveta.</p>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
