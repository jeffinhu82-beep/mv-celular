import { formatCsvMoney, formatDateTime, formatMoney } from '@loja/shared';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { PeriodValue } from '@/components/filters/period-picker.tsx';
import { columnHelper, DataTable, Pagination } from '@/components/ui/data-table.tsx';
import { SearchInput } from '@/components/ui/masked.tsx';
import { Badge, Card, CardHeader } from '@/components/ui/misc.tsx';
import { useAuth } from '@/lib/auth.tsx';
import type { SoldItemRow, SoldItemsReport } from '@/lib/types.ts';
import { plural } from '@/lib/utils.ts';
import { ExportButton, FigureBand, ReportFrame, TableEmpty, useReport } from './shared.tsx';

const PAGE_SIZE = 50;
const itemCol = columnHelper<SoldItemRow>();

const CSV_HEADER = ['Venda', 'Data', 'OS', 'Produto ou serviço', 'Quantidade', 'Preço unitário (R$)', 'Desconto no item (R$)', 'Total do item (R$)', 'Vendedor', 'Cliente'];

function normalize(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function matches(row: SoldItemRow, term: string) {
  return [row.name, row.saleNumber, row.serviceOrderNumber, row.customerName, row.sellerName].some((value) => value && normalize(value).includes(term));
}

export function SoldItemsReportTab({ period }: { period: PeriodValue }) {
  const query = useReport<SoldItemsReport>('/api/reports/sale-items', period);
  return <ReportFrame query={query}>{(data) => <SoldItemsBody data={data} />}</ReportFrame>;
}

function SoldItemsBody({ data }: { data: SoldItemsReport }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const canOpenSale = can('sale.view_all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const term = normalize(search.trim());
  const rows = useMemo(() => (term ? data.items.filter((row) => matches(row, term)) : data.items), [data.items, term]);
  const lastPage = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, lastPage);
  const pageRows = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const totals = useMemo(
    () => ({
      qty: rows.reduce((total, row) => total + row.qty, 0),
      sales: new Set(rows.map((row) => row.saleId)).size,
      totalCents: rows.reduce((total, row) => total + row.totalCents, 0),
    }),
    [rows],
  );

  const columns = useMemo(
    () => [
      itemCol.accessor('name', {
        header: 'Produto ou serviço',
        cell: (info) => {
          const row = info.row.original;
          return (
            <div>
              <p className="font-medium">{info.getValue()}</p>
              <p className="num text-xs text-muted md:hidden">
                {row.saleNumber} · {formatDateTime(row.completedAt)}
              </p>
              <p className="text-xs text-muted 2xl:hidden">
                {row.customerName ?? 'Consumidor'} · {row.sellerName}
              </p>
              {row.discountCents > 0 && <p className="num text-xs text-muted xl:hidden">desconto {formatMoney(row.discountCents)}</p>}
            </div>
          );
        },
      }),
      itemCol.accessor('saleNumber', {
        header: 'Venda',
        meta: { className: 'hidden md:table-cell' },
        cell: (info) => (
          <span className="inline-flex items-center gap-2">
            <span className="num">{info.getValue()}</span>
            {info.row.original.serviceOrderNumber && <Badge tone="info">{info.row.original.serviceOrderNumber}</Badge>}
          </span>
        ),
      }),
      itemCol.accessor('completedAt', { header: 'Data', meta: { className: 'hidden md:table-cell' }, cell: (info) => <span className="num text-muted">{formatDateTime(info.getValue())}</span> }),
      itemCol.accessor('qty', { header: 'Qtd.', meta: { align: 'right' }, cell: (info) => <span className="num">{info.getValue()}</span> }),
      itemCol.accessor('unitPriceCents', {
        header: 'Preço unit.',
        meta: { align: 'right', className: 'hidden sm:table-cell' },
        cell: (info) => <span className="num text-muted">{formatMoney(info.getValue())}</span>,
      }),
      itemCol.accessor('discountCents', {
        header: 'Desconto',
        meta: { align: 'right', className: 'hidden xl:table-cell' },
        cell: (info) => <span className="num text-muted">{info.getValue() > 0 ? formatMoney(info.getValue()) : '—'}</span>,
      }),
      itemCol.accessor('totalCents', { header: 'Total', meta: { align: 'right' }, cell: (info) => <span className="num font-medium">{formatMoney(info.getValue())}</span> }),
      itemCol.accessor('customerName', {
        header: 'Cliente',
        meta: { className: 'hidden 2xl:table-cell' },
        cell: (info) => info.getValue() ?? <span className="text-muted">Consumidor</span>,
      }),
      itemCol.accessor('sellerName', { header: 'Vendedor', meta: { className: 'hidden 2xl:table-cell' } }),
    ],
    [],
  );

  const csvRows = rows.map((row) => [
    row.saleNumber,
    formatDateTime(row.completedAt),
    row.serviceOrderNumber ?? '',
    row.name,
    row.qty,
    formatCsvMoney(row.unitPriceCents),
    formatCsvMoney(row.discountCents),
    formatCsvMoney(row.totalCents),
    row.sellerName,
    row.customerName ?? 'Consumidor',
  ]);

  return (
    <>
      <FigureBand
        items={[
          { label: 'Itens vendidos', value: totals.qty },
          { label: 'Vendas', value: totals.sales },
          { label: 'Total dos itens', value: formatMoney(totals.totalCents), hint: 'Sem o desconto dado no total da venda' },
        ]}
      />

      <Card>
        <CardHeader
          title="Itens vendidos"
          description="Uma linha por item, já com o desconto do item. Vendas canceladas ficam de fora."
          actions={<ExportButton name="itens-vendidos" label="itens vendidos" period={data.period} header={CSV_HEADER} rows={csvRows} />}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
          <SearchInput
            value={search}
            onValueChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Produto, venda, cliente ou vendedor"
            aria-label="Buscar item vendido"
            className="w-full sm:w-72"
          />
          {term && (
            <p className="text-sm text-muted" aria-live="polite">
              {plural(rows.length, 'item encontrado', 'itens encontrados')}
            </p>
          )}
        </div>
        <DataTable
          columns={columns}
          data={pageRows}
          getRowId={(row) => row.id}
          onRowClick={canOpenSale ? (row) => navigate(`/vendas/${row.saleId}`) : undefined}
          empty={<TableEmpty>{term ? 'Nenhum item com essa busca.' : 'Nenhum item vendido no período.'}</TableEmpty>}
        />
        <Pagination page={current} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} />
      </Card>
    </>
  );
}
