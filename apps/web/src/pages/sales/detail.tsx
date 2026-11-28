import { formatBps, formatDateTime, formatMoney, SALE_ORIGIN_LABELS } from '@loja/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, HandCoins, MessageCircle, Printer, RefreshCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useStoreSettings } from '@/components/layout/app-shell.tsx';
import { SectionLoader } from '@/components/layout/loader.tsx';
import { Button } from '@/components/ui/button.tsx';
import { ConfirmDialog } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Textarea } from '@/components/ui/input.tsx';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/misc.tsx';
import { invalidateMoney, useCashStatus } from '@/features/cash/queries.ts';
import { PaymentDialog, type PaymentSubmit } from '@/features/sales/payment-dialog.tsx';
import { ReceiptDialog, useSale } from '@/features/sales/receipt.tsx';
import { methodLabel, SALE_LOG_LABELS, saleCode, SaleStatusBadge, saleWhatsappLink } from '@/features/sales/shared.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';
import type { SaleDetail, SaleLog } from '@/lib/types.ts';
import { useToast } from '@/lib/toast.tsx';
import { cn } from '@/lib/utils.ts';
import { NotFoundPage } from '../errors.tsx';

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function MoneyRow({ label, cents, strong, tone }: { label: string; cents: number; strong?: boolean; tone?: 'warning' | 'success' | 'muted' }) {
  return (
    <div className={cn('flex justify-between gap-3 py-1 text-sm', strong && 'text-base font-semibold')}>
      <span className={cn(!strong && 'text-muted')}>{label}</span>
      <span className={cn('num', tone === 'warning' && 'text-warning', tone === 'success' && 'text-success', tone === 'muted' && 'text-muted')}>{formatMoney(cents)}</span>
    </div>
  );
}

function registeredWithBalance(log: SaleLog, sale: SaleDetail): boolean {
  return log.after?.status === 'pending' || sale.status === 'pending' || sale.logs.some((entry) => entry.action === 'sale.payment_received');
}

function saleLogLabel(log: SaleLog, sale: SaleDetail): string {
  if (log.action === 'sale.completed' && registeredWithBalance(log, sale)) return 'Venda registrada com saldo a receber';
  return SALE_LOG_LABELS[log.action] ?? log.action;
}

function logDetail(log: SaleLog): string | null {
  const after = log.after ?? {};
  if (typeof after.reason === 'string') return `Motivo: ${after.reason}`;
  if (typeof after.receivedCents === 'number') return `Recebido ${formatMoney(after.receivedCents)}`;
  if (typeof after.discountCents === 'number') return `Desconto de ${formatMoney(after.discountCents)}`;
  return null;
}

export function SaleDetailPage() {
  const { id = '' } = useParams();
  const sale = useSale(id);

  if (sale.isPending) return <SectionLoader />;
  if (sale.error instanceof ApiError && (sale.error.status === 404 || sale.error.status === 400)) return <NotFoundPage />;
  if (!sale.data) return <EmptyState title="Não foi possível carregar a venda" description={errorMessage(sale.error)} />;
  return <SaleView sale={sale.data} />;
}

function SaleView({ sale }: { sale: SaleDetail }) {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useStoreSettings();
  const cash = useCashStatus();
  const [printing, setPrinting] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();

  const quote = sale.status === 'quote';
  const expired = quote && Boolean(sale.quoteValidUntil && new Date(sale.quoteValidUntil) < new Date());
  const cashOpen = Boolean(cash.data?.session);
  const whats = saleWhatsappLink(sale, settings.data);
  const canSell = can('sale.create');
  const canCancel = sale.status !== 'cancelled' && sale.origin !== 'os' && (can('sale.cancel') || canSell);
  const showCost = sale.costCents !== undefined;
  const showFinance = sale.feeCents !== undefined;
  const title = quote ? `Orçamento ${sale.quoteNumber}` : `Venda ${saleCode(sale)}`;

  const receive = async ({ payments }: PaymentSubmit) => {
    try {
      await api.post(`/api/sales/${sale.id}/payments`, { payments });
      await invalidateMoney(queryClient);
      setReceiving(false);
      toast.success('Saldo recebido', `Pagamento registrado na venda ${sale.number}.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'APPROVAL_CANCELLED') return;
      toast.error('Não foi possível receber', errorMessage(error));
    }
  };

  const cancel = async () => {
    if (!reason.trim()) {
      setReasonError('Informe o motivo do cancelamento.');
      return;
    }
    try {
      await api.post(`/api/sales/${sale.id}/cancel`, { reason: reason.trim() });
      await invalidateMoney(queryClient);
      setCancelling(false);
      toast.success(quote ? 'Orçamento cancelado' : 'Venda cancelada', quote ? undefined : 'Estoque devolvido e pagamentos estornados no caixa.');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'APPROVAL_CANCELLED') return;
      if (error instanceof ApiError && error.code === 'VALIDATION') setReasonError(error.fieldErrors().reason);
      else toast.error('Não foi possível cancelar', errorMessage(error));
    }
  };

  const itemCost = (unitCostCents: number | undefined, qty: number) => (unitCostCents === undefined ? null : unitCostCents * qty);
  const surchargeCents = sale.payments.reduce((sum, payment) => sum + (payment.reversedAt ? 0 : payment.surchargeCents), 0);
  const marginCents = sale.marginCents === undefined ? undefined : sale.marginCents + (showFinance ? surchargeCents - (sale.feeCents ?? 0) : 0);
  const marginBps = marginCents !== undefined && sale.totalCents > 0 ? Math.round((marginCents / sale.totalCents) * 10000) : null;

  return (
    <>
      <div className="mb-4">
        <Link to={quote ? '/vendas?aba=orcamentos' : '/vendas'} className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft className="size-4" /> {quote ? 'Orçamentos' : 'Histórico de vendas'}
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="num text-xl font-semibold">{title}</h1>
            <SaleStatusBadge status={sale.status} expired={expired} />
            {sale.origin === 'os' && <Badge tone="info">{SALE_ORIGIN_LABELS.os}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">
            {formatDateTime(quote ? sale.quoteCreatedAt : (sale.completedAt ?? sale.createdAt))} · {sale.sellerName}
            {sale.customer ? ` · ${sale.customer.name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {quote && !expired && canSell && (
            <Button variant="primary" onClick={() => navigate(`/vender?orcamento=${sale.id}`)}>
              <RefreshCw /> Converter em venda
            </Button>
          )}
          {sale.status === 'pending' && canSell && (
            <Button variant="primary" onClick={() => setReceiving(true)} disabled={!cashOpen} title={cashOpen ? undefined : 'Abra o caixa para receber'}>
              <HandCoins /> Receber saldo
            </Button>
          )}
          <Button onClick={() => setPrinting(true)}>
            <Printer /> {quote ? 'Imprimir' : 'Reimprimir'}
          </Button>
          {whats ? (
            <Button asChild>
              <a href={whats} target="_blank" rel="noreferrer">
                <MessageCircle /> WhatsApp
              </a>
            </Button>
          ) : (
            <Button disabled title="Venda sem cliente com telefone">
              <MessageCircle /> WhatsApp
            </Button>
          )}
          {canCancel && (
            <Button
              variant="danger"
              onClick={() => {
                setReason('');
                setReasonError(undefined);
                setCancelling(true);
              }}
            >
              <Ban /> {quote ? 'Cancelar orçamento' : 'Cancelar venda'}
            </Button>
          )}
        </div>
      </div>

      {sale.status === 'cancelled' && (
        <div role="status" className="mb-4 rounded-md border border-border bg-surface-2 px-4 py-3 text-sm">
          <p className="font-medium">
            Cancelada em {formatDateTime(sale.cancelledAt)}
            {sale.cancelledByName ? ` por ${sale.cancelledByName}` : ''}
          </p>
          {sale.cancelReason && <p className="mt-0.5 text-muted">Motivo: {sale.cancelReason}</p>}
        </div>
      )}
      {sale.status === 'pending' && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <span>
            Falta receber <strong className="num">{formatMoney(sale.balanceCents)}</strong> de {sale.customer?.name ?? 'cliente'}.
          </span>
          {!cashOpen && <span className="text-xs">Abra o caixa para registrar o recebimento.</span>}
        </div>
      )}
      {expired && (
        <div role="status" className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Orçamento vencido em {formatDateTime(sale.quoteValidUntil)}. Faça um novo orçamento no PDV com os preços de hoje.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader title="Itens" />
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Item</th>
                    <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">Qtd</th>
                    <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">Unitário</th>
                    <th className="hidden px-2 py-2 text-right font-medium md:table-cell">Desconto</th>
                    {showCost && <th className="hidden px-2 py-2 text-right font-medium md:table-cell">Custo</th>}
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.items.map((item) => {
                    const cost = itemCost(item.unitCostCents, item.qty);
                    const changed = item.listPriceCents !== null && item.listPriceCents !== item.unitPriceCents;
                    return (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2">
                          <p className="font-medium">{item.name}</p>
                          <p className="num text-xs text-muted sm:hidden">
                            {item.qty} × {formatMoney(item.unitPriceCents)}
                          </p>
                          {item.discountCents > 0 && <p className="num text-xs text-muted md:hidden">desconto {formatMoney(-item.discountCents)}</p>}
                          {changed && <p className="text-xs text-warning">Tabela {formatMoney(item.listPriceCents)}</p>}
                        </td>
                        <td className="num hidden px-2 py-2 text-right sm:table-cell">{item.qty}</td>
                        <td className="num hidden px-2 py-2 text-right sm:table-cell">{formatMoney(item.unitPriceCents)}</td>
                        <td className="num hidden px-2 py-2 text-right text-muted md:table-cell">{item.discountCents > 0 ? formatMoney(-item.discountCents) : '—'}</td>
                        {showCost && <td className="num hidden px-2 py-2 text-right text-muted md:table-cell">{cost === null ? '—' : formatMoney(cost)}</td>}
                        <td className="num px-4 py-2 text-right font-medium">{formatMoney(item.totalCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="ml-auto w-full max-w-xs border-t border-border px-4 py-3">
              <MoneyRow label="Subtotal" cents={sale.subtotalCents} />
              {sale.discountCents > 0 && <MoneyRow label="Desconto no total" cents={-sale.discountCents} />}
              <MoneyRow label="Total" cents={sale.totalCents} strong />
              {!quote && <MoneyRow label={sale.status === 'cancelled' ? 'Estornado' : 'Pago'} cents={sale.paidCents} tone={sale.status === 'cancelled' ? 'muted' : undefined} />}
              {sale.balanceCents > 0 && <MoneyRow label="Saldo a receber" cents={sale.balanceCents} tone="warning" />}
            </div>
          </Card>

          {!quote && (
            <Card>
              <CardHeader title="Pagamentos" description={sale.payments.length === 0 ? 'Nenhum pagamento registrado.' : undefined} />
              {sale.payments.length > 0 && (
                <ul className="divide-y divide-border">
                  {sale.payments.map((payment) => (
                    <li key={payment.id} className={cn('flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm', payment.reversedAt && 'opacity-70')}>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {methodLabel(payment.method, payment.installments)}
                          {payment.reversedAt && <Badge tone="muted">Estornado em {formatDateTime(payment.reversedAt)}</Badge>}
                        </p>
                        <p className="text-xs text-muted">
                          {formatDateTime(payment.receivedAt)} · {payment.receivedByName}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={cn('num font-medium', payment.reversedAt && 'line-through')}>{formatMoney(payment.amountCents)}</p>
                        <p className="num text-xs text-muted">
                          {[
                            payment.surchargeCents > 0 ? `acréscimo ${formatMoney(payment.surchargeCents)}` : null,
                            payment.changeCents > 0 ? `troco ${formatMoney(payment.changeCents)}` : null,
                            payment.feeCents !== undefined && payment.feeCents > 0
                              ? `taxa ${formatMoney(payment.feeCents)}${payment.feePercentBps ? ` (${formatBps(payment.feePercentBps)})` : ''}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {showFinance && sale.payments.length > 0 && sale.status !== 'cancelled' && (
                <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-sm text-muted">
                  <span>
                    Taxas <span className="num text-text">{formatMoney(sale.feeCents ?? 0)}</span>
                  </span>
                  <span>
                    Líquido recebido <span className="num font-medium text-text">{formatMoney(sale.netCents ?? 0)}</span>
                  </span>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {!quote && sale.status !== 'cancelled' && (showFinance || showCost) && (
            <Card>
              <CardHeader title="Resultado da venda" />
              <div className="px-4 pb-3">
                <MoneyRow label="Total da venda" cents={sale.totalCents} />
                {showCost && <MoneyRow label="Custo dos produtos" cents={-(sale.costCents ?? 0)} />}
                {showFinance && surchargeCents > 0 && <MoneyRow label="Acréscimo pago pelo cliente" cents={surchargeCents} />}
                {showFinance && <MoneyRow label="Taxas de cartão e Pix" cents={-(sale.feeCents ?? 0)} />}
                {marginCents !== undefined && (
                  <div className="mt-1 flex justify-between gap-3 border-t border-border pt-2 text-sm font-semibold">
                    <span>{showFinance ? 'Margem após taxas' : 'Margem'}</span>
                    <span className={cn('num', marginCents < 0 ? 'text-primary-text' : 'text-success')}>
                      {formatMoney(marginCents)}
                      {marginBps !== null && <span className="ml-1 text-xs font-normal text-muted">({formatBps(marginBps)})</span>}
                    </span>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Detalhes" />
            <dl className="divide-y divide-border px-4 pb-2">
              <InfoRow label="Cliente">
                {sale.customer ? (
                  <Link to={`/clientes/${sale.customer.id}`} className="text-primary-text hover:underline">
                    {sale.customer.name}
                  </Link>
                ) : (
                  'Consumidor'
                )}
              </InfoRow>
              <InfoRow label={quote ? 'Atendente' : 'Vendedor'}>{sale.sellerName}</InfoRow>
              <InfoRow label="Origem">{SALE_ORIGIN_LABELS[sale.origin]}</InfoRow>
              {sale.serviceOrder && (
                <InfoRow label="OS vinculada">
                  <Link to={`/os/${sale.serviceOrder.id}`} className="num text-primary-text hover:underline">
                    {sale.serviceOrder.number}
                  </Link>{' '}
                  <span className="text-muted">
                    {sale.serviceOrder.brand} {sale.serviceOrder.model}
                  </span>
                </InfoRow>
              )}
              {!quote && sale.quoteNumber && <InfoRow label="Orçamento">{sale.quoteNumber}</InfoRow>}
              {quote && <InfoRow label="Validade">{formatDateTime(sale.quoteValidUntil)}</InfoRow>}
              {sale.approvedByName && <InfoRow label="Autorizado por">{sale.approvedByName}</InfoRow>}
              {sale.notes && <InfoRow label="Observação">{sale.notes}</InfoRow>}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Histórico" />
            <ol className="flex flex-col gap-3 px-4 pb-4">
              {sale.logs.length === 0 && <li className="text-sm text-muted">Sem registros.</li>}
              {sale.logs.map((log) => {
                const detail = logDetail(log);
                return (
                  <li key={log.id} className="relative border-l border-border pl-3 text-sm">
                    <span className="absolute top-1.5 -left-1 size-2 rounded-full bg-border" aria-hidden />
                    <p className="font-medium">{saleLogLabel(log, sale)}</p>
                    <p className="text-xs text-muted">
                      {formatDateTime(log.createdAt)}
                      {log.userName ? ` · ${log.userName}` : ''}
                      {log.approvedByName ? ` · autorizado por ${log.approvedByName}` : ''}
                    </p>
                    {detail && <p className="text-xs text-muted">{detail}</p>}
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>

      <ReceiptDialog saleId={sale.id} open={printing} onOpenChange={setPrinting} />
      <PaymentDialog
        open={receiving}
        onOpenChange={setReceiving}
        dueCents={sale.balanceCents}
        hasCustomer
        pendingAllowed={false}
        title={`Receber saldo da venda ${sale.number ?? ''}`}
        dueLabel="Saldo a receber"
        description={`Venda de ${formatMoney(sale.totalCents)} · já pago ${formatMoney(sale.paidCents)}`}
        confirmLabel="Confirmar recebimento"
        onSubmit={receive}
      />
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={quote ? `Cancelar orçamento ${sale.quoteNumber}?` : `Cancelar venda ${sale.number}?`}
        description={
          quote
            ? 'O orçamento fica marcado como cancelado e não pode mais virar venda.'
            : 'O estoque volta, os pagamentos são estornados no caixa aberto e a venda continua no histórico como cancelada.'
        }
        confirmLabel={quote ? 'Cancelar orçamento' : 'Cancelar venda'}
        destructive
        confirmDisabled={!quote && !cashOpen}
        onConfirm={cancel}
      >
        <div className="flex flex-col gap-3">
          {!quote && !cashOpen && (
            <p role="alert" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              O caixa está fechado. Abra o caixa para registrar o estorno.
            </p>
          )}
          {!quote && sale.paidCents > 0 && cashOpen && (
            <p className="text-sm text-muted">
              Estorno de <span className="num font-medium text-text">{formatMoney(sale.paidCents)}</span> no caixa atual.
            </p>
          )}
          {!can('sale.cancel') && <p className="text-sm text-muted">Alguém com permissão vai precisar autorizar.</p>}
          <Field label="Motivo" required error={reasonError}>
            <Textarea
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonError(undefined);
              }}
              rows={3}
              maxLength={300}
              placeholder="Ex.: cliente desistiu, produto com defeito"
            />
          </Field>
        </div>
      </ConfirmDialog>
    </>
  );
}
