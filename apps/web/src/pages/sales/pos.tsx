import { computeCart, formatBps, formatMoney, type DiscountInput } from '@loja/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Minus, Percent, Plus, ShoppingCart, Trash2, Wallet } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button.tsx';
import { ConfirmDialog } from '@/components/ui/dialog.tsx';
import { Textarea } from '@/components/ui/input.tsx';
import { MoneyInput } from '@/components/ui/masked.tsx';
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc.tsx';
import { invalidateMoney, useCashStatus } from '@/features/cash/queries.ts';
import { CustomerPicker, type PickedCustomer } from '@/features/sales/customer-picker.tsx';
import { DiscountDialog } from '@/features/sales/discount-dialog.tsx';
import { PaymentDialog, type PaymentSubmit } from '@/features/sales/payment-dialog.tsx';
import { ProductSearch } from '@/features/sales/product-search.tsx';
import { ReceiptDialog } from '@/features/sales/receipt.tsx';
import { ApiError, api, errorMessage } from '@/lib/api.ts';
import { useAuth, useUser } from '@/lib/auth.tsx';
import { useHotkeys } from '@/lib/hooks.ts';
import { useToast } from '@/lib/toast.tsx';
import type { Product, SaleDetail } from '@/lib/types.ts';
import { cn } from '@/lib/utils.ts';

interface CartLine {
  key: number;
  productId: string | null;
  name: string;
  qty: number;
  unitPriceCents: number;
  listPriceCents: number;
  maxQty: number | null;
  discount?: DiscountInput;
}

type DiscountTarget = { kind: 'total' } | { kind: 'item'; key: number } | null;

let lineSeq = 0;

function toDiscount(mode: DiscountInput['mode'] | null, value: number | null): DiscountInput | undefined {
  return mode && value ? { mode, value } : undefined;
}

function describeDiscount(discount: DiscountInput | undefined, cents: number) {
  if (!discount || cents === 0) return null;
  return discount.mode === 'percent' ? `−${formatMoney(cents)} (${formatBps(discount.value)})` : `−${formatMoney(cents)}`;
}

export function PosPage() {
  const user = useUser();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const cash = useCashStatus();
  const productRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [discount, setDiscount] = useState<DiscountInput | undefined>();
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [quote, setQuote] = useState<{ id: string; number: string | null } | null>(null);
  const [discountTarget, setDiscountTarget] = useState<DiscountTarget>(null);
  const [paying, setPaying] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [savingQuote, setSavingQuote] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  useEffect(() => {
    if (!cash.isLoading) productRef.current?.focus();
  }, [cash.isLoading]);

  const quoteParam = params.get('orcamento');
  const quoteQuery = useQuery({
    queryKey: ['sale', quoteParam],
    queryFn: () => api.get<SaleDetail>(`/api/sales/${quoteParam}`),
    enabled: Boolean(quoteParam),
  });

  useEffect(() => {
    const data = quoteQuery.data;
    if (!data || !quoteParam) return;
    setParams({}, { replace: true });
    if (data.status !== 'quote') {
      toast.error('Orçamento indisponível', 'Este orçamento já foi convertido ou cancelado.');
      return;
    }
    if (data.quoteValidUntil && new Date(data.quoteValidUntil) < new Date()) {
      toast.error('Orçamento vencido', 'Faça um novo orçamento com os preços de hoje.');
      return;
    }
    setLines(
      data.items.map((item) => ({
        key: ++lineSeq,
        productId: item.productId,
        name: item.name,
        qty: item.qty,
        unitPriceCents: item.unitPriceCents,
        listPriceCents: item.listPriceCents ?? item.unitPriceCents,
        maxQty: null,
        discount: toDiscount(item.discountMode, item.discountValue),
      })),
    );
    setCustomer(data.customer ? { id: data.customer.id, name: data.customer.name, phoneE164: data.customer.phoneE164 } : null);
    setDiscount(toDiscount(data.discountMode, data.discountValue));
    setNotes(data.notes ?? '');
    setShowNotes(Boolean(data.notes));
    setQuote({ id: data.id, number: data.quoteNumber });
  }, [quoteQuery.data, quoteParam, setParams, toast]);

  const cart = useMemo(
    () => computeCart(lines.map((line) => ({ qty: line.qty, unitPriceCents: line.unitPriceCents, discount: line.discount })), discount),
    [lines, discount],
  );
  const overLimit = cart.effectiveDiscountBps > user.discountLimitBps && cart.discountCents > 0;
  const overridden = lines.some((line) => line.productId && line.unitPriceCents !== line.listPriceCents);
  const cashOpen = Boolean(cash.data?.session);
  const anyDialog = paying || discarding || discountTarget !== null || receipt !== null;

  const addProduct = (product: Product) => {
    const maxQty = product.type === 'product' && product.tracksStock ? product.availableQty : null;
    const existing = lines.find((line) => line.productId === product.id);
    const nextQty = (existing?.qty ?? 0) + 1;
    if (maxQty !== null && nextQty > maxQty) {
      toast.error('Sem estoque suficiente', maxQty > 0 ? `Só ${maxQty} disponível de ${product.name}.` : `${product.name} está sem estoque.`);
      return;
    }
    if (existing) {
      setLines((current) => current.map((line) => (line.key === existing.key ? { ...line, qty: nextQty, maxQty } : line)));
    } else {
      setLines((current) => [
        ...current,
        { key: ++lineSeq, productId: product.id, name: product.name, qty: 1, unitPriceCents: product.priceCents, listPriceCents: product.priceCents, maxQty },
      ]);
    }
  };

  const updateLine = (key: number, patch: Partial<CartLine>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const setQty = (line: CartLine, qty: number) => {
    if (qty < 1) return;
    if (line.maxQty !== null && qty > line.maxQty) {
      toast.error('Sem estoque suficiente', `Só ${line.maxQty} disponível de ${line.name}.`);
      return;
    }
    updateLine(line.key, { qty });
  };

  const reset = () => {
    setLines([]);
    setCustomer(null);
    setDiscount(undefined);
    setNotes('');
    setShowNotes(false);
    setQuote(null);
    window.setTimeout(() => productRef.current?.focus(), 50);
  };

  const body = () => ({
    customerId: customer?.id,
    items: lines.map((line) => ({
      ...(line.productId ? { productId: line.productId } : {}),
      name: line.name,
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      ...(line.discount ? { discount: line.discount } : {}),
    })),
    ...(discount ? { discount } : {}),
    notes: notes.trim() || undefined,
  });

  const handleError = (title: string, error: unknown) => {
    if (error instanceof ApiError && error.code === 'APPROVAL_CANCELLED') return;
    toast.error(title, errorMessage(error));
  };

  const saveQuote = async () => {
    if (lines.length === 0) return;
    setSavingQuote(true);
    try {
      const saved = await api.post<SaleDetail>('/api/quotes', body());
      void queryClient.invalidateQueries({ queryKey: ['quotes'] });
      toast.success('Orçamento salvo', saved.quoteNumber ? `Número ${saved.quoteNumber}.` : undefined);
      reset();
      setReceipt(saved.id);
    } catch (error) {
      handleError('Não foi possível salvar o orçamento', error);
    } finally {
      setSavingQuote(false);
    }
  };

  const finalize = async ({ payments, allowPending }: PaymentSubmit) => {
    try {
      const sale = await api.post<SaleDetail>('/api/sales', { ...body(), payments, allowPending, ...(quote ? { quoteId: quote.id } : {}) });
      invalidateMoney(queryClient);
      setPaying(false);
      toast.success(sale.status === 'pending' ? 'Venda registrada com saldo a receber' : 'Venda finalizada', sale.number ? `Venda ${sale.number}.` : undefined);
      reset();
      setReceipt(sale.id);
    } catch (error) {
      handleError('Não foi possível finalizar a venda', error);
    }
  };

  const openPayment = () => {
    if (lines.length === 0) {
      productRef.current?.focus();
      return;
    }
    if (!cashOpen) {
      toast.error('Caixa fechado', 'Abra o caixa para finalizar vendas.');
      return;
    }
    setPaying(true);
  };

  useHotkeys(
    {
      F2: (event) => {
        event.preventDefault();
        productRef.current?.focus();
      },
      F4: (event) => {
        event.preventDefault();
        if (customer) setCustomer(null);
        window.setTimeout(() => customerRef.current?.focus(), 0);
      },
      F8: (event) => {
        event.preventDefault();
        if (lines.length > 0) setDiscountTarget({ kind: 'total' });
      },
      F10: (event) => {
        event.preventDefault();
        openPayment();
      },
      Escape: () => {
        if (anyDialog || document.querySelector('[role="dialog"][data-state="open"]')) return;
        if (lines.length > 0) setDiscarding(true);
      },
    },
    !receipt,
  );

  const itemTarget = discountTarget?.kind === 'item' ? lines.find((line) => line.key === discountTarget.key) : undefined;

  if (cash.isLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Vender"
        description="Bipe o código ou busque o produto. F2 busca, F4 cliente, F8 desconto, F10 finaliza, Esc descarta."
        actions={
          quote ? (
            <Badge tone="info">
              <FileText className="size-3" /> Convertendo orçamento {quote.number}
            </Badge>
          ) : undefined
        }
      />

      {!cashOpen && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <span>
            <strong className="font-semibold">Caixa fechado.</strong> Dá para montar o carrinho e salvar orçamento, mas a venda só fecha com o caixa aberto.
          </span>
          {can('cash.open_close') && (
            <Button size="sm" variant="secondary" asChild>
              <Link to="/caixa">
                <Wallet /> Abrir caixa
              </Link>
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Card className="flex min-w-0 flex-col gap-3 p-4">
          <ProductSearch ref={productRef} onPick={addProduct} />
          {lines.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title="Carrinho vazio"
              description="Bipe o código de barras ou digite o nome do produto acima. Para orçamentos salvos, use Vendas › Orçamentos."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border" aria-label="Itens do carrinho">
              {lines.map((line, index) => {
                const computed = cart.items[index];
                const changed = Boolean(line.productId) && line.unitPriceCents !== line.listPriceCents;
                return (
                  <li key={line.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{line.name}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        {changed && <span className="text-warning">Tabela {formatMoney(line.listPriceCents)}</span>}
                        {describeDiscount(line.discount, computed?.discountCents ?? 0) && (
                          <span>Desconto {describeDiscount(line.discount, computed?.discountCents ?? 0)}</span>
                        )}
                        {line.maxQty !== null && <span>{line.maxQty} em estoque</span>}
                      </div>
                      </div>
                      <span className="num font-medium sm:hidden">{formatMoney(computed?.totalCents ?? 0)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-md border border-border">
                        <Button variant="ghost" size="icon-sm" aria-label={`Diminuir ${line.name}`} onClick={() => setQty(line, line.qty - 1)} disabled={line.qty <= 1}>
                          <Minus />
                        </Button>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          aria-label={`Quantidade de ${line.name}`}
                          value={line.qty}
                          onChange={(event) => setQty(line, Math.floor(Number(event.target.value) || 1))}
                          className="num h-8 w-10 bg-transparent text-center text-sm [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <Button variant="ghost" size="icon-sm" aria-label={`Aumentar ${line.name}`} onClick={() => setQty(line, line.qty + 1)}>
                          <Plus />
                        </Button>
                      </div>
                      <MoneyInput
                        aria-label={`Preço unitário de ${line.name}`}
                        value={line.unitPriceCents}
                        onValueChange={(value) => updateLine(line.key, { unitPriceCents: value })}
                        className={cn('w-28', changed && 'border-warning')}
                      />
                      <Button variant="ghost" size="icon-sm" aria-label={`Desconto em ${line.name}`} title="Desconto no item" onClick={() => setDiscountTarget({ kind: 'item', key: line.key })}>
                        <Percent />
                      </Button>
                      <span className="num hidden w-24 text-right font-medium sm:block">{formatMoney(computed?.totalCents ?? 0)}</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="ml-auto sm:ml-0"
                        aria-label={`Remover ${line.name}`}
                        onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            <CustomerPicker ref={customerRef} value={customer} onChange={setCustomer} />
            {showNotes ? (
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observações da venda" rows={2} aria-label="Observações" />
            ) : (
              <button type="button" className="self-start text-xs text-primary-text hover:underline" onClick={() => setShowNotes(true)}>
                Adicionar observação
              </button>
            )}
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Itens ({lines.reduce((total, line) => total + line.qty, 0)})</dt>
                <dd className="num">{formatMoney(cart.grossCents)}</dd>
              </div>
              {cart.itemsDiscountCents > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted">Desconto nos itens</dt>
                  <dd className="num">−{formatMoney(cart.itemsDiscountCents)}</dd>
                </div>
              )}
              <div className="flex items-center justify-between">
                <dt>
                  <button type="button" className="text-primary-text hover:underline disabled:text-muted disabled:no-underline" disabled={lines.length === 0} onClick={() => setDiscountTarget({ kind: 'total' })}>
                    {discount ? 'Desconto no total' : 'Dar desconto (F8)'}
                  </button>
                </dt>
                <dd className="num">{cart.totalDiscountCents > 0 ? `−${formatMoney(cart.totalDiscountCents)}` : '—'}</dd>
              </div>
              <div className="mt-2 flex items-baseline justify-between border-t border-border pt-3">
                <dt className="font-semibold">Total</dt>
                <dd className="num text-2xl font-bold">{formatMoney(cart.totalCents)}</dd>
              </div>
            </dl>
            {(overLimit || overridden) && (
              <p className="text-xs text-warning">
                {overLimit && `Desconto de ${formatBps(cart.effectiveDiscountBps)} passa do seu limite (${formatBps(user.discountLimitBps)}). `}
                {overridden && !can('sale.price_override') && 'Preço alterado. '}
                {(overLimit || (overridden && !can('sale.price_override'))) && 'Alguém com permissão vai autorizar ao finalizar.'}
              </p>
            )}
            <Button variant="primary" size="lg" onClick={openPayment} disabled={lines.length === 0 || !cashOpen}>
              Finalizar venda <kbd className="ml-1 rounded bg-black/20 px-1 text-[10px]">F10</kbd>
            </Button>
            <div className="flex gap-2">
              {!quote && (
                <Button variant="secondary" className="flex-1" onClick={() => void saveQuote()} disabled={lines.length === 0} loading={savingQuote}>
                  <FileText /> Salvar como orçamento
                </Button>
              )}
              <Button variant="ghost" className="flex-1" onClick={() => setDiscarding(true)} disabled={lines.length === 0 && !customer && !quote}>
                Descartar
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <DiscountDialog
        open={discountTarget !== null}
        onOpenChange={(open) => !open && setDiscountTarget(null)}
        title={itemTarget ? `Desconto em ${itemTarget.name}` : 'Desconto no total'}
        baseCents={itemTarget ? itemTarget.qty * itemTarget.unitPriceCents : cart.subtotalCents}
        value={itemTarget ? itemTarget.discount : discount}
        limitBps={user.discountLimitBps}
        onApply={(value) => {
          if (itemTarget) updateLine(itemTarget.key, { discount: value });
          else setDiscount(value);
        }}
      />

      <PaymentDialog open={paying} onOpenChange={setPaying} dueCents={cart.totalCents} hasCustomer={Boolean(customer)} confirmLabel="Confirmar venda" onSubmit={finalize} />

      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Descartar esta venda?"
        description="O carrinho, o cliente e os descontos serão apagados. Nada foi registrado ainda."
        confirmLabel="Descartar"
        destructive
        onConfirm={() => {
          setDiscarding(false);
          reset();
        }}
      />

      <ReceiptDialog
        saleId={receipt}
        open={receipt !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReceipt(null);
            window.setTimeout(() => productRef.current?.focus(), 50);
          }
        }}
        onNewSale={() => {
          setReceipt(null);
          window.setTimeout(() => productRef.current?.focus(), 50);
        }}
      />
      {quoteParam && quoteQuery.isError && (
        <p className="text-sm text-warning">
          Não foi possível carregar o orçamento. <button type="button" className="underline" onClick={() => navigate('/vender', { replace: true })}>Começar venda nova</button>
        </p>
      )}
    </div>
  );
}
