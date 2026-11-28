import { formatCsvMoney, formatMoney } from '@loja/shared';
import { useMemo } from 'react';
import { PeriodPicker, periodQuery, readPeriod } from '@/components/filters/period-picker.tsx';
import { columnHelper, DataTable } from '@/components/ui/data-table.tsx';
import { Badge, Card, CardHeader } from '@/components/ui/misc.tsx';
import { ExportButton, ReportFrame, TableEmpty, useReport } from '@/features/reports/shared.tsx';
import type { useSearchState } from '@/lib/hooks.ts';
import type { TeamPerformance } from '@/lib/types.ts';

type Row = TeamPerformance['items'][number];
const col = columnHelper<Row>();

export function PerformanceTab({ params, update }: { params: URLSearchParams; update: ReturnType<typeof useSearchState>[1] }) {
  const period = readPeriod(params, 'month');
  const query = useReport<TeamPerformance>('/api/team/performance', period);

  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: 'Pessoa',
        cell: ({ row }) => (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 sm:whitespace-nowrap">
            {row.original.name}
            {!row.original.active && <Badge>Inativo</Badge>}
          </span>
        ),
      }),
      col.accessor('roleName', { header: 'Perfil', meta: { className: 'hidden md:table-cell' }, cell: (info) => <span className="text-muted">{info.getValue()}</span> }),
      col.accessor('salesCount', { header: 'Vendas', meta: { align: 'right', className: 'hidden sm:table-cell' } }),
      col.accessor('salesTotalCents', { header: 'Total vendido', meta: { align: 'right' }, cell: (info) => <span className="num font-medium">{formatMoney(info.getValue())}</span> }),
      col.accessor('averageTicketCents', {
        header: 'Ticket médio',
        meta: { align: 'right', className: 'hidden sm:table-cell' },
        cell: ({ row }) => <span className="num text-muted">{row.original.salesCount > 0 ? formatMoney(row.original.averageTicketCents) : '—'}</span>,
      }),
      col.accessor('completedOrders', { header: 'OS concluídas', meta: { align: 'right' } }),
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <PeriodPicker value={period} onChange={(value) => update({ from: null, to: null, ...periodQuery(value) })} />
      <ReportFrame query={query}>
        {(data) => (
          <Card>
            <CardHeader
              title="Desempenho no período"
              description="Vendas pelo vendedor da venda; OS pelo técnico responsável quando ficou pronta."
              actions={
                <ExportButton
                  name="desempenho-equipe"
                  label="desempenho da equipe"
                  period={data.period}
                  header={['Pessoa', 'Perfil', 'Ativo', 'Vendas', 'Total vendido (R$)', 'Ticket médio (R$)', 'OS concluídas']}
                  rows={data.items.map((row) => [row.name, row.roleName, row.active ? 'Sim' : 'Não', row.salesCount, formatCsvMoney(row.salesTotalCents), row.salesCount > 0 ? formatCsvMoney(row.averageTicketCents) : '', row.completedOrders])}
                />
              }
            />
            <DataTable columns={columns} data={data.items} getRowId={(row) => row.userId} empty={<TableEmpty>Ninguém da equipe vendeu ou concluiu OS no período.</TableEmpty>} />
          </Card>
        )}
      </ReportFrame>
    </div>
  );
}
