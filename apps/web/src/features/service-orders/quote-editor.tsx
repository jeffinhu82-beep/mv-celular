import { formatMoney, OS_ITEM_KIND_LABELS, type OsItemKind } from '@loja/shared';
import { AlertTriangle, Hammer, Trash2, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { MoneyInput } from '@/components/ui/masked.tsx';
import { Badge } from '@/components/ui/misc.tsx';
import { ProductSearch } from '@/features/sales/product-search.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import { useToast } from '@/lib/toast.tsx';
import type { Product, ServiceOrderDetail } from '@/lib/types.ts';
import { cn } from '@/lib/utils.ts';

interface DraftLine {
  key: number;
  productId: string | null;
  kind: OsItemKind;
  name: string;
  qty: number;
  unitPriceCents: number;
  availableQty: number | null;
}

let nextKey = 1;

function fromDetail(os: ServiceOrderDetail): DraftLine[] {
  return os.items.map((item) => ({
    key: nextKey++,
    productId: item.productId,
    kind: item.kind,
    name: item.name,
    qty: item.qty,
    unitPriceCents: item.unitPriceCents,
    availableQty: item.tracksStock ? item.availableQty : null,
  }));
}

export function QuoteEditorDialog({ os, open, onOpenChange, onSaved }: { os: ServiceOrderDetail; open: boolean; onOpenChange(open: boolean): void; onSaved(detail: ServiceOrderDetail): void }) {
  const toast = useToast();
  const [lines, setLines] = useState<DraftLine[]>(() => fromDetail(os));
  const [discount, setDiscount] = useState(os.discountCents);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLines(fromDetail(os));
    setDiscount(os.discountCents);
  }, [open, os]);

  const knownAvailable = useMemo(() => new Map(os.items.filter((item) => item.productId && item.tracksStock).map((item) => [item.productId!, item.availableQty])), [os.items]);

  const gross = lines.reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0);
  const total = Math.max(0, gross - discount);
  const neededByProduct = new Map<string, number>();
  for (const line of lines) if (line.kind === 'part' && line.productId) neededByProduct.set(line.productId, (neededByProduct.get(line.productId) ?? 0) + line.qty);
  const shortageOf = (line: DraftLine) => line.kind === 'part' && line.productId !== null && line.availableQty !== null && (neededByProduct.get(line.productId) ?? 0) > line.availableQty;
  const belowDeposit = total < os.depositCents;
  const invalid = lines.some((line) => !line.name.trim() || line.qty < 1) || discount > gross || belowDeposit;

  const update = (key: number, patch: Partial<DraftLine>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const remove = (key: number) => setLines((current) => current.filter((line) => line.key !== key));

  const pick = (product: Product) => {
    const kind: OsItemKind = product.type === 'service' ? 'service' : 'part';
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id && line.kind === kind);
      if (existing) return current.map((line) => (line === existing ? { ...line, qty: line.qty + 1 } : line));
      const available = product.tracksStock && product.type === 'product' ? (knownAvailable.get(product.id) ?? product.availableQty) : null;
      return [...current, { key: nextKey++, productId: product.id, kind, name: product.name, qty: 1, unitPriceCents: product.priceCents, availableQty: available }];
    });
  };

  const addFree = (kind: OsItemKind) =>
    setLines((current) => [...current, { key: nextKey++, productId: null, kind, name: kind === 'labor' ? 'Mão de obra' : '', qty: 1, unitPriceCents: 0, availableQty: null }]);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.put<ServiceOrderDetail>(`/api/service-orders/${os.id}/items`, {
        items: lines.map((line) => ({ productId: line.productId, kind: line.kind, name: line.name.trim(), qty: line.qty, unitPriceCents: line.unitPriceCents })),
        discountCents: discount,
      });
      toast.success('Orçamento salvo', `Total ${formatMoney(saved.totalCents)}.`);
      onSaved(saved);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'APPROVAL_CANCELLED') return;
      toast.error('Não foi possível salvar o orçamento', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="xl"
        title={`Orçamento · ${os.number}`}
        description="Peças baixam do estoque só na entrega. Até lá ficam reservadas."
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving || invalid}>
              {saving ? 'Salvando…' : 'Salvar orçamento'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <ProductSearch onPick={pick} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => addFree('labor')}>
                <Hammer /> Mão de obra
              </Button>
              <Button variant="outline" size="sm" onClick={() => addFree('service')}>
                <Wrench /> Serviço avulso
              </Button>
            </div>
          </div>

          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Busque uma peça ou serviço do catálogo, ou lance a mão de obra.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {lines.map((line) => {
                const shortage = shortageOf(line);
                return (
                  <li key={line.key} className="flex flex-col gap-2 p-3">
                    <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                      <Badge tone={line.kind === 'part' ? 'info' : line.kind === 'labor' ? 'warning' : 'neutral'} className="shrink-0">
                        {OS_ITEM_KIND_LABELS[line.kind]}
                      </Badge>
                      {line.productId ? (
                        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={line.name}>
                          {line.name}
                        </span>
                      ) : (
                        <Input
                          value={line.name}
                          onChange={(event) => update(line.key, { name: event.target.value })}
                          placeholder="Descrição"
                          aria-label="Descrição do item"
                          aria-invalid={!line.name.trim() || undefined}
                          className="h-8 min-w-0 flex-1"
                        />
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          value={line.qty}
                          onChange={(event) => update(line.key, { qty: Math.max(1, Math.floor(Number(event.target.value) || 1)) })}
                          aria-label="Quantidade"
                          className="num h-8 w-16 text-right"
                        />
                        <span className="text-xs text-muted">×</span>
                        <MoneyInput value={line.unitPriceCents} onValueChange={(cents) => update(line.key, { unitPriceCents: cents })} aria-label="Preço unitário" className="h-8 w-28" />
                        <span className="num w-24 text-right text-sm font-semibold">{formatMoney(line.qty * line.unitPriceCents)}</span>
                        <Button variant="ghost" size="icon-sm" aria-label={`Remover ${line.name || 'item'}`} onClick={() => remove(line.key)} className="text-muted">
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                    {shortage && (
                      <p className="flex items-center gap-1.5 text-xs text-warning">
                        <AlertTriangle className="size-3.5" aria-hidden />
                        Estoque livre: {line.availableQty}. A OS fica como "Aguardando peça" até a reposição.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="ml-auto flex w-full max-w-xs flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Subtotal</span>
              <span className="num">{formatMoney(gross)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="os-discount" className="text-muted">
                Desconto
              </label>
              <MoneyInput id="os-discount" value={discount} onValueChange={setDiscount} max={gross} className="h-8 w-32" />
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
              <span>Total</span>
              <span className="num">{formatMoney(total)}</span>
            </div>
            {os.depositCents > 0 && (
              <div className={cn('flex justify-between text-xs', belowDeposit ? 'text-warning' : 'text-muted')}>
                <span>Sinal já pago</span>
                <span className="num">{formatMoney(os.depositCents)}</span>
              </div>
            )}
            {belowDeposit && <p className="text-xs text-warning">O total não pode ficar abaixo do sinal já recebido.</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
