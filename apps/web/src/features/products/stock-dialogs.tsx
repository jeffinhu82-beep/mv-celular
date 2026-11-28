import { formatMoney } from '@loja/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input, Textarea } from '@/components/ui/input.tsx';
import { MoneyInput } from '@/components/ui/masked.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';
import type { Product } from '@/lib/types.ts';
import { useToast } from '@/lib/toast.tsx';

interface StockDialogProps {
  product: Product | null;
  onOpenChange(open: boolean): void;
}

async function refreshStock(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['products'] }),
    queryClient.invalidateQueries({ queryKey: ['stock-movements'] }),
    queryClient.invalidateQueries({ queryKey: ['low-stock'] }),
  ]);
}

export function StockEntryDialog({ product, onOpenChange }: StockDialogProps) {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState(0);
  const [supplier, setSupplier] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const showCost = can('product.cost.view');

  useEffect(() => {
    if (!product) return;
    setQty('');
    setUnitCost(product.costCents ?? 0);
    setSupplier('');
    setNotes('');
    setErrors({});
  }, [product]);

  const quantity = Number(qty) || 0;
  const currentCost = product?.costCents ?? 0;
  const newAverage =
    product && quantity > 0 && product.stockQty >= 0
      ? Math.round((Math.max(0, product.stockQty) * currentCost + quantity * unitCost) / (Math.max(0, product.stockQty) + quantity))
      : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!product) return;
    if (quantity <= 0 || !Number.isInteger(quantity)) return setErrors({ qty: 'Informe uma quantidade inteira maior que zero' });
    setSaving(true);
    try {
      await api.post('/api/stock/entries', { productId: product.id, qty: quantity, unitCostCents: unitCost, supplier: supplier || null, notes: notes || null });
      await refreshStock(queryClient);
      toast.success('Entrada registrada', `${quantity} × ${product.name}`);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION') setErrors(error.fieldErrors());
      else toast.error('Não foi possível registrar', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(product)} onOpenChange={onOpenChange}>
      <DialogContent
        title="Entrada de estoque"
        description={product ? `${product.name} · estoque atual ${product.stockQty}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" form="stock-entry-form" loading={saving}>
              Registrar entrada
            </Button>
          </>
        }
      >
        <form id="stock-entry-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Quantidade" required error={errors.qty}>
            <Input autoFocus type="number" min={1} inputMode="numeric" value={qty} onChange={(event) => setQty(event.target.value)} />
          </Field>
          <Field label="Custo unitário" required error={errors.unitCostCents} hint={showCost && newAverage !== null ? `Novo custo médio: ${formatMoney(newAverage)}` : undefined}>
            <MoneyInput value={unitCost} onValueChange={setUnitCost} />
          </Field>
          <Field label="Fornecedor" error={errors.supplier} className="sm:col-span-2">
            <Input value={supplier} onChange={(event) => setSupplier(event.target.value)} />
          </Field>
          <Field label="Observação" error={errors.notes} className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ex.: nota fiscal 1234" />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StockAdjustDialog({ product, onOpenChange }: StockDialogProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!product) return;
    setDirection('out');
    setQty('');
    setReason('');
    setErrors({});
  }, [product]);

  const quantity = Number(qty) || 0;
  const delta = direction === 'in' ? quantity : -quantity;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!product) return;
    const next: Record<string, string> = {};
    if (quantity <= 0 || !Number.isInteger(quantity)) next.qty = 'Informe uma quantidade inteira maior que zero';
    if (!reason.trim()) next.reason = 'Explique o motivo do ajuste';
    if (Object.keys(next).length) return setErrors(next);
    setSaving(true);
    try {
      await api.post('/api/stock/adjustments', { productId: product.id, qtyDelta: delta, reason: reason.trim() });
      await refreshStock(queryClient);
      toast.success('Ajuste registrado', `${product.name}: ${product.stockQty} → ${product.stockQty + delta}`);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION') setErrors(error.fieldErrors());
      else toast.error('Não foi possível ajustar', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(product)} onOpenChange={onOpenChange}>
      <DialogContent
        title="Ajuste de estoque"
        description={product ? `${product.name} · estoque atual ${product.stockQty}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" form="stock-adjust-form" loading={saving}>
              Registrar ajuste
            </Button>
          </>
        }
      >
        <form id="stock-adjust-form" onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de ajuste">
            {(['out', 'in'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={direction === value}
                onClick={() => setDirection(value)}
                className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${direction === value ? 'border-primary bg-primary/10 text-primary-text' : 'border-border text-muted hover:text-text'}`}
              >
                {value === 'out' ? 'Retirar (perda, defeito)' : 'Adicionar (contagem)'}
              </button>
            ))}
          </div>
          <Field label="Quantidade" required error={errors.qty ?? errors.qtyDelta} hint={product && quantity > 0 ? `Estoque fica em ${product.stockQty + delta}` : undefined}>
            <Input autoFocus type="number" min={1} inputMode="numeric" value={qty} onChange={(event) => setQty(event.target.value)} />
          </Field>
          <Field label="Motivo" required error={errors.reason}>
            <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: tela quebrou na instalação, contagem de inventário" />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
