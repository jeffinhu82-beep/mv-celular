import { formatCsvMoney, formatDate, formatDateTime, formatMoney, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, SALE_ORIGIN_LABELS, SALE_STATUS_LABELS, type PaymentMethod } from '@loja/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, FileText, Plus, Receipt, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PeriodPicker, periodQuery, readPeriod, type PeriodValue } from '@/components/filters/period-picker.tsx';
import { Button } from '@/components/ui/button.tsx';
import { columnHelper, DataTable, Pagination } from '@/components/ui/data-table.tsx';
import { NativeSelect } from '@/components/ui/input.tsx';
import { SearchInput } from '@/components/ui/masked.tsx';
import { Badge, Card, EmptyState, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc.tsx';
import { periodFileSuffix } from '@/features/reports/shared.tsx';
import { ReceivablesTab } from '@/features/sales/receivables-tab.tsx';
import { SaleStatusBadge } from '@/features/sales/shared.tsx';
import { api, errorMessage } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';
import { downloadText, toCsv } from '@/lib/csv.ts';
import { useSearchState, useSearchText } from '@/lib/hooks.ts';
import { useToast } from '@/lib/toast.tsx';
import type { Paged, QuoteListStatus, QuoteRow, SaleExport, SaleExportRow, SaleList, SaleRow, UserOption } from '@/lib/types.ts';
import { cn, plural, toQuery } from '@/lib/utils.ts';

const PAGE_SIZE = 30;
const saleCol = columnHelper<SaleRow>();
const quoteCol = columnHelper<QuoteRow>();

export const QUOTE_STATUS: Record<QuoteListStatus, { label: string; tone: 'info' | 'muted' | 'success' | 'warning' }> = {
  open: { label: 'Vigente', tone: 'info' },
  expired: { label: 'Vencido', tone: 'warning' },
  converted: { label: 'Convertido', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'muted' },
};

export function SalesHistoryPage() {
  const { can } = useAuth();
  const [params, update] = useSearchState();
  const aba = params.get('aba');
  const tab = aba === 'orcamentos' ? 'quotes' : aba === 'receber' && can('sale.create') ? 'receivables' : 'sales';

  return (
    <>
      <PageHeader
        title="Histórico de vendas"
        description="Consulte, reimprima, receba saldos e cancele vendas. Orçamentos e pendências ficam nas outras abas."
        actions={
          can('sale.create') && (
            <Button asChild variant="primary">
              <Link to="/vender">
                <Plus /> Nova venda
              </Link>
            </Button>
          )
        }
      />
      <Tabs value={tab} onValueChange={(value) => update({ aba: value === 'quotes' ? 'orcamentos' : value === 'receivables' ? 'receber' : null, q: null, status: null })}>
        <TabsList className="mb-4">
          <TabsTrigger value="sales">Vendas</TabsTrigger>
          <TabsTrigger value="quotes">Orçamentos</TabsTrigger>
          {can('sale.create') && <TabsTrigger value="receivables">A receber</TabsTrigger>}
        </TabsList>
        <TabsContent value="sales">{tab === 'sales' && <SalesTab params={params} update={update} />}</TabsContent>
        <TabsContent value="quotes">{tab === 'quotes' && <QuotesTab params={params} update={update} />}</TabsContent>
        <TabsContent value="receivables">{tab === 'receivables' && <ReceivablesTab />}</TabsContent>
      </Tabs>
    </>
  );
}

type TabProps = { params: URLSearchParams; update: ReturnType<typeof useSearchState>[1] };

function SalesTab({ params, update }: TabProps) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const viewAll = can('sale.view_all');
  const period = readPeriod(params, 'month');
  const page = Math.max(1, Number(params.get('page')) || 1);
  const filters = {
    sellerId: viewAll ? (params.get('vendedor') ?? '') : '',
    method: params.get('forma') ?? '',
    status: params.get('status') ?? '',
    origin: params.get('origem') ?? '',
    q: params.get('q') ?? '',
  };
  const [text, setText] = useSearchText(filters.q, (value) => update({ q: value }));

  const sellers = useQuery({
    queryKey: ['users', 'options'],
    queryFn: () => api.get<UserOption[]>('/api/users/options'),
    enabled: viewAll,
    staleTime: 5 * 60_000,
  });

  const query = { ...periodQuery(period), ...filters, page, pageSize: PAGE_SIZE };
  const sales = useQuery({
    queryKey: ['sales', query],
    queryFn: () => api.get<SaleList>(`/api/sales${toQuery(query)}`),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo(
    () => [
      saleCol.accessor('number', {
        header: 'Venda',
        cell: (info) => {
          const sale = info.row.original;
          return (
            <div>
              <span className="inline-flex items-center gap-2">
                <span className="num font-medium">{info.getValue()}</span>
                {sale.serviceOrder && <Badge tone="info">{sale.serviceOrder.number}</Badge>}
              </span>
              <p className={cn('md:hidden', !sale.customer && 'text-muted')}>{sale.customer?.name ?? 'Consumidor'}</p>
              <p className="num text-xs text-muted md:hidden">{formatDateTime(sale.completedAt)}</p>
              {(sale.status !== 'completed' || sale.balanceCents > 0) && (
                <span className="mt-1 inline-flex flex-wrap items-center gap-1.5 sm:hidden">
                  <SaleStatusBadge status={sale.status} />
                  {sale.balanceCents > 0 && <span className="num text-xs text-warning">falta {formatMoney(sale.balanceCents)}</span>}
                </span>
              )}
            </div>
          );
        },
      }),
      saleCol.accessor('completedAt', { header: 'Data', meta: { className: 'hidden md:table-cell' }, cell: (info) => <span className="num text-muted">{formatDateTime(info.getValue())}</span> }),
      saleCol.accessor('customer', { header: 'Cliente', meta: { className: 'hidden md:table-cell' }, cell: (info) => info.getValue()?.name ?? <span className="text-muted">Consumidor</span> }),
      ...(viewAll ? [saleCol.accessor('sellerName', { header: 'Vendedor', meta: { className: 'hidden xl:table-cell' } })] : []),
      saleCol.accessor('methods', {
        header: 'Forma',
        meta: { className: 'hidden xl:table-cell' },
        cell: (info) => <span className="text-muted">{info.getValue().map((method) => PAYMENT_METHOD_LABELS[method]).join(', ') || '—'}</span>,
      }),
      saleCol.accessor('status', {
        header: 'Situação',
        meta: { className: 'hidden sm:table-cell' },
        cell: (info) => (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <SaleStatusBadge status={info.getValue()} />
            {info.row.original.balanceCents > 0 && <span className="num text-xs text-warning">falta {formatMoney(info.row.original.balanceCents)}</span>}
          </span>
        ),
      }),
      saleCol.accessor('totalCents', {
        header: 'Total',
        meta: { align: 'right' },
        cell: (info) => (
          <span className={cn('num font-medium', info.row.original.status === 'cancelled' && 'text-muted line-through')}>{formatMoney(info.getValue())}</span>
        ),
      }),
    ],
    [viewAll],
  );

  const filtered = Boolean(filters.sellerId || filters.method || filters.status || filters.origin || filters.q);

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeriodPicker value={period} onChange={(value: PeriodValue) => update(periodQuery(value))} />
          {sales.data && (
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted" aria-live="polite">
                <span className="text-text">{plural(sales.data.validCount, 'venda', 'vendas')}</span> · total{' '}
                <span className="num font-semibold text-text">{formatMoney(sales.data.totalCents)}</span>
                <span className="hidden sm:inline"> (sem canceladas)</span>
              </p>
              <SalesExportButton query={{ ...periodQuery(period), ...filters }} withSeller={viewAll} disabled={sales.data.total === 0} />
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:flex lg:flex-wrap">
          <SearchInput value={text} onValueChange={setText} placeholder="Número da venda ou cliente" aria-label="Buscar venda" className="col-span-2 md:col-span-3 lg:w-64" />
          {viewAll && (
            <NativeSelect aria-label="Vendedor" value={filters.sellerId} onChange={(event) => update({ vendedor: event.target.value })} className="lg:w-48">
              <option value="">Vendedor: todos</option>
              {(sellers.data ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </NativeSelect>
          )}
          <NativeSelect aria-label="Forma de pagamento" value={filters.method} onChange={(event) => update({ forma: event.target.value })} className="lg:w-48">
            <option value="">Forma: todas</option>
            {PAYMENT_METHODS.map((method: PaymentMethod) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Situação" value={filters.status} onChange={(event) => update({ status: event.target.value })} className="lg:w-48">
            <option value="">Situação: todas</option>
            <option value="completed">Concluídas</option>
            <option value="pending">Com saldo a receber</option>
            <option value="cancelled">Canceladas</option>
          </NativeSelect>
          <NativeSelect aria-label="Origem" value={filters.origin} onChange={(event) => update({ origem: event.target.value })} className="lg:w-40">
            <option value="">Origem: todas</option>
            <option value="counter">{SALE_ORIGIN_LABELS.counter}</option>
            <option value="os">{SALE_ORIGIN_LABELS.os}</option>
          </NativeSelect>
          {filtered && (
            <Button variant="ghost" onClick={() => update({ vendedor: null, forma: null, status: null, origem: null, q: null })}>
              Limpar filtros
            </Button>
          )}
        </div>
      </div>
      <DataTable
        columns={columns}
        data={sales.data?.items ?? []}
        loading={sales.isPending}
        getRowId={(row) => row.id}
        onRowClick={(row) => navigate(`/vendas/${row.id}`)}
        rowClassName={(row) => (row.status === 'cancelled' ? 'opacity-70' : undefined)}
        empty={
          <EmptyState
            icon={Receipt}
            title={filtered ? 'Nenhuma venda com esses filtros' : 'Nenhuma venda neste período'}
            description={filtered ? 'Mude os filtros ou o período.' : 'Escolha outro período ou registre uma venda no PDV.'}
          />
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={sales.data?.total ?? 0} onPageChange={(next) => update({ page: String(next) })} />
    </Card>
  );
}

function saleCsvRow(sale: SaleExportRow, withSeller: boolean) {
  return [
    sale.number,
    formatDateTime(sale.completedAt),
    SALE_STATUS_LABELS[sale.status],
    SALE_ORIGIN_LABELS[sale.origin],
    sale.serviceOrder?.number ?? '',
    sale.customer?.name ?? 'Consumidor',
    ...(withSeller ? [sale.sellerName] : []),
    sale.methods.map((method) => PAYMENT_METHOD_LABELS[method]).join(', '),
    sale.items.map((item) => `${item.qty}x ${item.name}`).join(', '),
    formatCsvMoney(sale.discountCents),
    formatCsvMoney(sale.totalCents),
    formatCsvMoney(sale.balanceCents),
  ];
}

function SalesExportButton({ query, withSeller, disabled }: { query: Record<string, string | undefined>; withSeller: boolean; disabled: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function exportSales() {
    setBusy(true);
    try {
      const data = await api.get<SaleExport>(`/api/sales/export${toQuery(query)}`);
      const header = ['Venda', 'Data', 'Situação', 'Origem', 'OS', 'Cliente', ...(withSeller ? ['Vendedor'] : []), 'Formas de pagamento', 'Itens', 'Desconto (R$)', 'Total (R$)', 'A receber (R$)'];
      const name = data.period ? `vendas_${periodFileSuffix(data.period)}.csv` : 'vendas.csv';
      downloadText(name, toCsv(header, data.items.map((sale) => saleCsvRow(sale, withSeller))));
    } catch (error) {
      toast.error('Exportação não concluída', errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" loading={busy} disabled={disabled} aria-label="Exportar vendas em CSV" onClick={exportSales} className="-my-1 text-muted hover:text-text">
      {!busy && <Download />} CSV
    </Button>
  );
}

function QuotesTab({ params, update }: TabProps) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const status = params.get('status') ?? '';
  const q = params.get('q') ?? '';
  const [text, setText] = useSearchText(q, (value) => update({ q: value }));
  const canSell = can('sale.create');

  const query = { status, q, page, pageSize: PAGE_SIZE };
  const quotes = useQuery({
    queryKey: ['quotes', query],
    queryFn: () => api.get<Paged<QuoteRow>>(`/api/quotes${toQuery(query)}`),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo(
    () => [
      quoteCol.accessor('quoteNumber', {
        header: 'Orçamento',
        cell: (info) => {
          const quote = info.row.original;
          const meta = QUOTE_STATUS[quote.status];
          return (
            <div>
              <p className="num font-medium">{info.getValue()}</p>
              <p className={cn('md:hidden', !quote.customer && 'text-muted')}>{quote.customer?.name ?? 'Sem cliente'}</p>
              <Badge tone={meta.tone} className="mt-1 sm:hidden">
                {meta.label}
              </Badge>
            </div>
          );
        },
      }),
      quoteCol.accessor('quoteCreatedAt', { header: 'Criado em', meta: { className: 'hidden xl:table-cell' }, cell: (info) => <span className="num text-muted">{formatDate(info.getValue())}</span> }),
      quoteCol.accessor('customer', { header: 'Cliente', meta: { className: 'hidden md:table-cell' }, cell: (info) => info.getValue()?.name ?? <span className="text-muted">Sem cliente</span> }),
      quoteCol.accessor('itemsCount', { header: 'Itens', meta: { align: 'right', className: 'hidden xl:table-cell' }, cell: (info) => <span className="num">{info.getValue()}</span> }),
      quoteCol.accessor('totalCents', { header: 'Total', meta: { align: 'right' }, cell: (info) => <span className="num font-medium">{formatMoney(info.getValue())}</span> }),
      quoteCol.accessor('quoteValidUntil', {
        header: 'Validade',
        meta: { className: 'hidden sm:table-cell' },
        cell: (info) => <span className={cn('num', info.row.original.status === 'expired' ? 'text-warning' : 'text-muted')}>{formatDate(info.getValue())}</span>,
      }),
      quoteCol.accessor('status', {
        header: 'Situação',
        meta: { className: 'hidden sm:table-cell' },
        cell: (info) => {
          const meta = QUOTE_STATUS[info.getValue()];
          return (
            <span className="inline-flex items-center gap-1.5">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              {info.row.original.saleNumber && <span className="num text-xs text-muted">{info.row.original.saleNumber}</span>}
            </span>
          );
        },
      }),
      quoteCol.display({
        id: 'actions',
        header: '',
        meta: { align: 'right' },
        cell: (info) =>
          info.row.original.status === 'open' && canSell ? (
            <Button
              size="sm"
              variant="secondary"
              aria-label="Converter em venda"
              onClick={(event) => {
                event.stopPropagation();
                navigate(`/vender?orcamento=${info.row.original.id}`);
              }}
            >
              <RefreshCw /> <span className="hidden sm:inline">Converter em venda</span>
            </Button>
          ) : null,
      }),
    ],
    [canSell, navigate],
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <SearchInput value={text} onValueChange={setText} placeholder="Número do orçamento ou cliente" aria-label="Buscar orçamento" className="w-full sm:w-72" />
        <NativeSelect aria-label="Situação do orçamento" value={status} onChange={(event) => update({ status: event.target.value })} className="w-full sm:w-44">
          <option value="">Todas as situações</option>
          {(Object.keys(QUOTE_STATUS) as QuoteListStatus[]).map((key) => (
            <option key={key} value={key}>
              {QUOTE_STATUS[key].label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <DataTable
        columns={columns}
        data={quotes.data?.items ?? []}
        loading={quotes.isPending}
        getRowId={(row) => row.id}
        onRowClick={(row) => navigate(`/vendas/${row.id}`)}
        empty={
          <EmptyState
            icon={FileText}
            title={q || status ? 'Nenhum orçamento com esses filtros' : 'Nenhum orçamento ainda'}
            description="No PDV, monte o carrinho e use Salvar como orçamento."
          />
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={quotes.data?.total ?? 0} onPageChange={(next) => update({ page: String(next) })} />
    </Card>
  );
}
