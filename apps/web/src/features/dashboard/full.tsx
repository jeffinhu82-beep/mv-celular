import { formatDate, formatDateTime, formatMoney, formatRelativeDays, PAYMENT_METHOD_LABELS, sum } from '@loja/shared';
import { ChevronDown } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useStoreSettings } from '@/components/layout/app-shell.tsx';
import { columnHelper, DataTable } from '@/components/ui/data-table.tsx';
import { Badge, Card, CardHeader } from '@/components/ui/misc.tsx';
import { SaleStatusBadge } from '@/features/sales/shared.tsx';
import { useStoredFlag } from '@/lib/hooks.ts';
import type { DashboardFull } from '@/lib/types.ts';
import { cn, plural } from '@/lib/utils.ts';
import { SalesChart } from './sales-chart.tsx';
import { CardLink, EmptyLine, ListCard, MaybeLink, OsCounters, StageDot, useCanOpen } from './shared.tsx';

type LatestSale = DashboardFull['latestSales'][number];
const saleCol = columnHelper<LatestSale>();

export function periodLabel(period: DashboardFull['period']): string {
  if (period.kind === 'today') return 'hoje';
  if (period.kind === 'yesterday') return 'ontem';
  if (period.kind === 'month') return 'este mês';
  const lastDay = new Date(new Date(period.end).getTime() - 1);
  const first = formatDate(period.start);
  const last = formatDate(lastDay);
  return first === last ? first : `${first} a ${last}`;
}

export function FullDashboard({ data }: { data: DashboardFull }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <SummaryBand data={data} className="md:col-span-2 xl:col-span-3" />
      <Card className="flex flex-col md:col-span-2">
        <CardHeader title={data.chart.granularity === 'hour' ? 'Vendas por hora' : 'Vendas por dia'} />
        <div className="flex flex-1 flex-col px-2 pt-3 pb-2 sm:px-4">
          <SalesChart points={data.chart.points} granularity={data.chart.granularity} />
        </div>
      </Card>
      <MethodsCard data={data} />
      <ServiceOrdersCard data={data} />
      <ReceivablesCard data={data} />
      <LowStockCard data={data} />
      <LatestSalesCard sales={data.latestSales} className="md:col-span-2 xl:col-span-3" />
    </div>
  );
}

function SummaryBand({ data, className }: { data: DashboardFull; className?: string }) {
  const s = data.summary;
  const [open, setOpen] = useStoredFlag('home.result-breakdown');
  const canOpen = useCanOpen();
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-4 xl:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
        <div className="col-span-2 bg-surface p-4 md:col-span-4 xl:col-span-1">
          <p className="text-sm text-muted">Resultado estimado · {periodLabel(data.period)}</p>
          <p className={cn('num mt-1 text-4xl font-semibold tracking-tight', s.resultCents < 0 && 'text-primary-text')}>{formatMoney(s.resultCents)}</p>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? 'result-breakdown' : undefined}
            onClick={() => setOpen(!open)}
            className="mt-2 -ml-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs font-medium text-muted transition-colors hover:text-text"
          >
            {open ? 'Ocultar composição' : 'Ver composição'}
            <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
          </button>
        </div>
        <Figure label="Vendas" value={formatMoney(s.salesTotalCents)} hint={s.salesCount > 0 ? `${plural(s.salesCount, 'venda', 'vendas')} · ticket ${formatMoney(s.averageTicketCents)}` : 'Nenhuma venda'} />
        <Figure label="Recebido" value={formatMoney(s.receivedCents)} hint="Em vendas e OS" />
        <Figure
          label="Dinheiro na gaveta"
          value={data.drawer ? formatMoney(data.drawer.expectedCashCents) : <span className="text-muted">Caixa fechado</span>}
          hint={data.drawer ? 'Esperado agora' : 'Abra o caixa para vender'}
          to={canOpen('/caixa') ? '/caixa' : undefined}
        />
        <Figure
          label="A receber"
          value={formatMoney(data.receivables.totalCents)}
          tone={data.receivables.totalCents > 0 ? 'warning' : undefined}
          hint={data.receivables.count > 0 ? plural(data.receivables.count, 'pendência', 'pendências') : 'Nenhuma pendência'}
          to={data.receivables.count > 0 && canOpen('/vendas') ? '/vendas?aba=receber' : undefined}
        />
      </div>
      {open && <ResultBreakdown data={data} />}
    </Card>
  );
}

function Figure({ label, value, hint, tone, to }: { label: string; value: ReactNode; hint: string; tone?: 'warning'; to?: string }) {
  const content = (
    <>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn('num mt-1 text-xl font-semibold tracking-tight', tone === 'warning' && 'text-warning')}>{value}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </>
  );
  if (!to) return <div className="min-w-0 bg-surface p-4">{content}</div>;
  return (
    <Link to={to} className="min-w-0 bg-surface p-4 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2">
      {content}
    </Link>
  );
}

function ResultBreakdown({ data }: { data: DashboardFull }) {
  const s = data.summary;
  const lines = [
    { label: 'Recebido em vendas e OS', cents: s.receivedCents, always: true },
    { label: 'Entradas avulsas', cents: s.incomeCents },
    { label: 'Taxas', cents: -s.feeCents },
    { label: 'Custo dos produtos vendidos', cents: -s.cmvCents },
  ].filter((line) => line.always || line.cents !== 0);
  const outside = [
    { label: 'Suprimentos', cents: s.supplyCents },
    { label: 'Saídas de caixa', cents: s.withdrawalCents },
  ].filter((line) => line.cents !== 0);
  return (
    <div id="result-breakdown" className="grid gap-x-8 gap-y-4 border-t border-border p-4 text-sm md:grid-cols-2">
      <dl className="space-y-1.5">
        {lines.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">{line.label}</dt>
            <dd className="num">{formatMoney(line.cents)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Custos registrados</dt>
          <dd className="num">{s.expenseCents === 0 ? <span className="text-xs text-muted">Nenhum custo registrado</span> : formatMoney(-s.expenseCents)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5 font-medium">
          <dt>Resultado estimado</dt>
          <dd className={cn('num', s.resultCents < 0 && 'text-primary-text')}>{formatMoney(s.resultCents)}</dd>
        </div>
      </dl>
      <div className="space-y-3">
        {outside.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Fora do resultado</p>
            <dl className="space-y-1.5">
              {outside.map((line) => (
                <div key={line.label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted">{line.label}</dt>
                  <dd className="num">{formatMoney(line.cents)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <p className="text-xs text-muted">Estimado porque usa o custo cadastrado dos produtos, e o sinal de uma OS entra no dia do pagamento.</p>
      </div>
    </div>
  );
}

function MethodsCard({ data, className }: { data: DashboardFull; className?: string }) {
  const rows = data.summary.byMethod.filter((row) => row.grossCents !== 0 || row.feeCents !== 0);
  const total = {
    grossCents: sum(rows.map((row) => row.grossCents)),
    feeCents: sum(rows.map((row) => row.feeCents)),
    netCents: sum(rows.map((row) => row.netCents)),
  };
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader title="Formas de pagamento" />
      {rows.length === 0 ? (
        <EmptyLine>Nenhum pagamento no período.</EmptyLine>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Forma
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Bruto
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Líquido
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.method} className="border-b border-border align-top">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  {PAYMENT_METHOD_LABELS[row.method]}
                </th>
                <td className="num px-2 py-2 text-right whitespace-nowrap">{formatMoney(row.grossCents)}</td>
                <td className="num px-4 py-2 text-right whitespace-nowrap">
                  {formatMoney(row.netCents)}
                  {row.feeCents !== 0 && <span className="block text-xs text-muted">taxa {formatMoney(-row.feeCents)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr className="align-top font-medium">
                <th scope="row" className="px-4 py-2.5 text-left">
                  Total
                </th>
                <td className="num px-2 py-2.5 text-right whitespace-nowrap">{formatMoney(total.grossCents)}</td>
                <td className="num px-4 py-2.5 text-right whitespace-nowrap">
                  {formatMoney(total.netCents)}
                  {total.feeCents !== 0 && <span className="block text-xs font-normal text-muted">taxa {formatMoney(-total.feeCents)}</span>}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </Card>
  );
}

function ServiceOrdersCard({ data, className }: { data: DashboardFull; className?: string }) {
  const canOpen = useCanOpen();
  const settings = useStoreSettings();
  const os = data.serviceOrders;
  const stages = os.byColumn.filter((column) => column.count > 0);
  return (
    <ListCard
      className={className}
      title="Ordens de serviço"
      description={os.openCount > 0 ? `${plural(os.openCount, 'aberta', 'abertas')} agora` : undefined}
      action={canOpen('/os') ? <CardLink to="/os">Abrir quadro</CardLink> : undefined}
    >
      {stages.length === 0 ? (
        <EmptyLine>Nenhuma OS aberta.</EmptyLine>
      ) : (
        <>
          <div className="px-4 pt-3">
            <OsCounters staleCount={os.staleCount} lateCount={os.lateCount} staleDays={settings.data?.staleOsDays} />
          </div>
          <ul className="py-2">
            {stages.map((column) => (
              <li key={column.id} className="flex items-center gap-2.5 px-4 py-1.5 text-sm">
                <StageDot color={column.color} />
                <span className="min-w-0 flex-1 truncate">{column.name}</span>
                <span className="num font-medium">{column.count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </ListCard>
  );
}

function ReceivablesCard({ data, className }: { data: DashboardFull; className?: string }) {
  const canOpen = useCanOpen();
  const { items, count } = data.receivables;
  return (
    <ListCard
      className={className}
      title="A receber"
      description={count > items.length ? `${items.length} de ${count} pendências` : undefined}
      action={count > 0 && canOpen('/vendas') ? <CardLink to="/vendas?aba=receber">{count > items.length ? 'Ver todas' : 'Abrir lista'}</CardLink> : undefined}
    >
      {items.length === 0 ? (
        <EmptyLine>Nada a receber.</EmptyLine>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`}>
              <MaybeLink
                to={item.kind === 'sale' ? `/vendas/${item.id}` : `/os/${item.id}`}
                enabled={canOpen(item.kind === 'sale' ? '/vendas' : '/os')}
                className="flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    <span className="num font-medium">{item.number}</span> <span className="text-muted">{item.customer?.name ?? 'Consumidor'}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">{[item.kind === 'os' ? item.label : null, formatRelativeDays(item.since)].filter(Boolean).join(' · ')}</p>
                </div>
                <span className="num shrink-0 font-medium">{formatMoney(item.balanceCents)}</span>
              </MaybeLink>
            </li>
          ))}
        </ul>
      )}
    </ListCard>
  );
}

function LowStockCard({ data, className }: { data: DashboardFull; className?: string }) {
  const canOpen = useCanOpen();
  const { items, count } = data.lowStock;
  return (
    <ListCard
      className={className}
      title="Estoque baixo"
      description={count > items.length ? `${items.length} de ${count} produtos abaixo do mínimo` : undefined}
      action={count > 0 && canOpen('/produtos') ? <CardLink to="/produtos?estoque=baixo">{count > items.length ? 'Ver todos' : 'Ver no estoque'}</CardLink> : undefined}
    >
      {items.length === 0 ? (
        <EmptyLine>Nenhum produto abaixo do estoque mínimo.</EmptyLine>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="num shrink-0 text-xs text-muted">
                <span className={cn('text-sm font-medium', item.stockQty <= 0 ? 'text-primary-text' : 'text-text')}>{item.stockQty <= 0 ? 'Esgotado' : item.stockQty}</span> / mín. {item.minStock}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ListCard>
  );
}

function LatestSalesCard({ sales, className }: { sales: LatestSale[]; className?: string }) {
  const navigate = useNavigate();
  const canOpen = useCanOpen();
  const clickable = canOpen('/vendas');
  const columns = useMemo(
    () => [
      saleCol.accessor('number', {
        header: 'Venda',
        cell: (info) => (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="num font-medium">{info.getValue() ?? '—'}</span>
            {info.row.original.origin === 'os' && <Badge tone="info">OS</Badge>}
            {info.row.original.status !== 'completed' && <SaleStatusBadge status={info.row.original.status} />}
            <span className="block w-full text-xs text-muted sm:hidden">{info.row.original.customerName ?? 'Consumidor'}</span>
          </span>
        ),
      }),
      saleCol.accessor('completedAt', {
        header: 'Quando',
        meta: { className: 'hidden sm:table-cell' },
        cell: (info) => <span className="num text-muted">{formatDateTime(info.getValue())}</span>,
      }),
      saleCol.accessor('customerName', {
        header: 'Cliente',
        meta: { className: 'hidden sm:table-cell' },
        cell: (info) => info.getValue() ?? <span className="text-muted">Consumidor</span>,
      }),
      saleCol.accessor('sellerName', { header: 'Vendedor', meta: { className: 'hidden md:table-cell' }, cell: (info) => <span className="text-muted">{info.getValue()}</span> }),
      saleCol.accessor('totalCents', {
        header: 'Total',
        meta: { align: 'right' },
        cell: (info) => <span className={cn('num font-medium', info.row.original.status === 'cancelled' && 'text-muted line-through')}>{formatMoney(info.getValue())}</span>,
      }),
    ],
    [],
  );
  return (
    <Card className={className}>
      <CardHeader title="Últimas vendas" actions={clickable ? <CardLink to="/vendas">Ver histórico</CardLink> : undefined} />
      <DataTable
        columns={columns}
        data={sales}
        getRowId={(sale) => sale.id}
        onRowClick={clickable ? (sale) => navigate(`/vendas/${sale.id}`) : undefined}
        empty={<EmptyLine>Nenhuma venda ainda.</EmptyLine>}
      />
    </Card>
  );
}
