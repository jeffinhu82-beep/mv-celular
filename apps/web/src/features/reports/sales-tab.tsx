import { formatCsvMoney, formatMoney, PAYMENT_METHOD_LABELS } from '@loja/shared';
import { useMemo, useState } from 'react';
import type { PeriodValue } from '@/components/filters/period-picker.tsx';
import { Button } from '@/components/ui/button.tsx';
import { columnHelper, DataTable } from '@/components/ui/data-table.tsx';
import { Card, CardHeader } from '@/components/ui/misc.tsx';
import { SalesChart } from '@/features/dashboard/sales-chart.tsx';
import { useAuth } from '@/lib/auth.tsx';
import type { MethodRow, SalesReport } from '@/lib/types.ts';
import { plural } from '@/lib/utils.ts';
import { dayLabel, ExportButton, FigureBand, ReportFrame, TableEmpty, useReport } from './shared.tsx';

type SellerRow = SalesReport['bySeller'][number];
type ProductRow = SalesReport['topProducts'][number];

const methodCol = columnHelper<MethodRow>();
const sellerCol = columnHelper<SellerRow>();
const productCol = columnHelper<ProductRow>();
const TOP_LIMIT = 10;

function money(cents: number | undefined) {
  return <span className="num">{cents === undefined ? '—' : formatMoney(cents)}</span>;
}

export function SalesReportTab({ period }: { period: PeriodValue }) {
  const query = useReport<SalesReport>('/api/reports/sales', period);
  return <ReportFrame query={query}>{(data) => <SalesReportBody data={data} />}</ReportFrame>;
}

function SalesReportBody({ data }: { data: SalesReport }) {
  const { can } = useAuth();
  const withFees = can('finance.view');
  const [allProducts, setAllProducts] = useState(false);
  const { totals } = data;

  const points = useMemo(() => data.byDay.map((day) => ({ key: day.day, salesCents: day.totalCents, salesCount: day.count, receivedCents: 0 })), [data.byDay]);
  const products = allProducts ? data.topProducts : data.topProducts.slice(0, TOP_LIMIT);

  const methodColumns = useMemo(
    () => [
      methodCol.accessor('method', { header: 'Forma', cell: (info) => PAYMENT_METHOD_LABELS[info.getValue()] }),
      methodCol.accessor('grossCents', { header: 'Bruto', meta: { align: 'right' }, cell: (info) => money(info.getValue()) }),
      ...(withFees
        ? [
            methodCol.accessor('feeCents', { header: 'Taxa', meta: { align: 'right', className: 'hidden sm:table-cell' }, cell: (info) => <span className="num text-muted">{info.getValue() ? formatMoney(-info.getValue()!) : '—'}</span> }),
            methodCol.accessor('netCents', { header: 'Líquido', meta: { align: 'right' }, cell: (info) => <span className="num font-medium">{info.getValue() === undefined ? '—' : formatMoney(info.getValue()!)}</span> }),
          ]
        : []),
    ],
    [withFees],
  );

  const sellerColumns = useMemo(
    () => [
      sellerCol.accessor('name', { header: 'Vendedor', cell: (info) => info.getValue() || <span className="text-muted">—</span> }),
      sellerCol.accessor('count', { header: 'Vendas', meta: { align: 'right' } }),
      sellerCol.accessor('totalCents', { header: 'Total', meta: { align: 'right' }, cell: (info) => <span className="num font-medium">{formatMoney(info.getValue())}</span> }),
      sellerCol.accessor('averageTicketCents', { header: 'Ticket médio', meta: { align: 'right', className: 'hidden sm:table-cell' }, cell: (info) => money(info.getValue()) }),
    ],
    [],
  );

  const productColumns = useMemo(
    () => [
      productCol.display({ id: 'rank', header: '#', meta: { className: 'w-10 hidden sm:table-cell' }, cell: (info) => <span className="num text-muted">{info.row.index + 1}</span> }),
      productCol.accessor('name', { header: 'Produto ou serviço', cell: (info) => <span className="block sm:max-w-md sm:truncate">{info.getValue()}</span> }),
      productCol.accessor('qty', { header: 'Qtd.', meta: { align: 'right' } }),
      productCol.accessor('totalCents', { header: 'Total', meta: { align: 'right' }, cell: (info) => <span className="num font-medium">{formatMoney(info.getValue())}</span> }),
    ],
    [],
  );

  const methodHeader = withFees ? ['Forma', 'Bruto (R$)', 'Taxa (R$)', 'Líquido (R$)'] : ['Forma', 'Bruto (R$)'];
  const methodRows = data.byMethod.map((row) =>
    withFees
      ? [PAYMENT_METHOD_LABELS[row.method], formatCsvMoney(row.grossCents), formatCsvMoney(row.feeCents ?? 0), formatCsvMoney(row.netCents)]
      : [PAYMENT_METHOD_LABELS[row.method], formatCsvMoney(row.grossCents)],
  );

  return (
    <>
      <FigureBand
        items={[
          { label: 'Vendas', value: totals.count },
          { label: 'Total vendido', value: formatMoney(totals.totalCents) },
          { label: 'Ticket médio', value: totals.count > 0 ? formatMoney(totals.averageTicketCents) : '—' },
          { label: 'Recebido', value: formatMoney(totals.receivedCents), hint: 'Inclui sinais e saldos de OS' },
        ]}
      />

      <Card>
        <CardHeader
          title="Vendas por dia"
          actions={
            <ExportButton
              name="vendas-por-dia"
              label="vendas por dia"
              period={data.period}
              header={['Dia', 'Vendas', 'Total (R$)']}
              rows={totals.count > 0 ? data.byDay.map((day) => [dayLabel(day.day), day.count, formatCsvMoney(day.totalCents)]) : []}
            />
          }
        />
        <div className="p-4">
          <SalesChart points={points} granularity="day" className="sm:h-64" />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Recebido por forma de pagamento"
            description={withFees ? 'Bruto, taxa da maquininha e líquido.' : 'Valor bruto. As taxas aparecem só para quem vê o financeiro.'}
            actions={<ExportButton name="recebido-por-forma" label="recebido por forma" period={data.period} header={methodHeader} rows={methodRows} />}
          />
          <DataTable columns={methodColumns} data={data.byMethod} getRowId={(row) => row.method} empty={<TableEmpty>Nada recebido no período.</TableEmpty>} />
        </Card>

        <Card>
          <CardHeader
            title="Por vendedor"
            actions={
              <ExportButton
                name="vendas-por-vendedor"
                label="vendas por vendedor"
                period={data.period}
                header={['Vendedor', 'Vendas', 'Total (R$)', 'Ticket médio (R$)']}
                rows={data.bySeller.map((row) => [row.name, row.count, formatCsvMoney(row.totalCents), formatCsvMoney(row.averageTicketCents)])}
              />
            }
          />
          <DataTable columns={sellerColumns} data={data.bySeller} getRowId={(row) => row.sellerId} empty={<TableEmpty>Nenhuma venda no período.</TableEmpty>} />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Mais vendidos"
          description={data.topProducts.length > 0 ? plural(data.topProducts.length, 'item diferente', 'itens diferentes') : undefined}
          actions={
            <ExportButton
              name="mais-vendidos"
              label="mais vendidos"
              period={data.period}
              header={['Produto ou serviço', 'Quantidade', 'Total (R$)']}
              rows={data.topProducts.map((row) => [row.name, row.qty, formatCsvMoney(row.totalCents)])}
            />
          }
        />
        <DataTable columns={productColumns} data={products} getRowId={(row) => row.productId ?? `free:${row.name}`} empty={<TableEmpty>Nenhum item vendido no período.</TableEmpty>} />
        {data.topProducts.length > TOP_LIMIT && (
          <div className="border-t border-border px-4 py-2">
            <Button variant="ghost" size="sm" className="-ml-2 text-muted hover:text-text" onClick={() => setAllProducts((value) => !value)}>
              {allProducts ? `Mostrar só os ${TOP_LIMIT} primeiros` : `Mostrar todos (${data.topProducts.length})`}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
