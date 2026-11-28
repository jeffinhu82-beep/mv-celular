import { formatCsvDecimal, formatDuration } from '@loja/shared';
import { useMemo } from 'react';
import type { PeriodValue } from '@/components/filters/period-picker.tsx';
import { columnHelper, DataTable } from '@/components/ui/data-table.tsx';
import { Card, CardHeader } from '@/components/ui/misc.tsx';
import type { ServiceOrderReport } from '@/lib/types.ts';
import { ExportButton, FigureBand, ReportFrame, TableEmpty, useReport } from './shared.tsx';

type TechnicianRow = ServiceOrderReport['byTechnician'][number];

const technicianCol = columnHelper<TechnicianRow>();

function hours(ms: number | null) {
  return ms === null ? '' : formatCsvDecimal(ms / 3_600_000);
}

export function ServiceOrdersReportTab({ period }: { period: PeriodValue }) {
  const query = useReport<ServiceOrderReport>('/api/reports/service-orders', period);
  const columns = useMemo(
    () => [
      technicianCol.accessor('name', { header: 'Técnico', cell: (info) => info.getValue() || <span className="text-muted">Sem técnico</span> }),
      technicianCol.accessor('opened', { header: 'Abertas', meta: { align: 'right', className: 'hidden sm:table-cell' } }),
      technicianCol.accessor('completed', { header: 'Concluídas', meta: { align: 'right' }, cell: (info) => <span className="num font-medium">{info.getValue()}</span> }),
      technicianCol.accessor('averageReadyMs', { header: 'Tempo médio', meta: { align: 'right' }, cell: (info) => <span className="num text-muted">{formatDuration(info.getValue())}</span> }),
    ],
    [],
  );

  return (
    <ReportFrame query={query}>
      {(data) => (
        <>
          <FigureBand
            items={[
              { label: 'OS abertas', value: data.totals.opened },
              { label: 'OS concluídas', value: data.totals.completed },
              { label: 'Tempo médio até ficar pronta', value: formatDuration(data.totals.averageReadyMs) },
            ]}
          />
          <Card>
            <CardHeader
              title="Por técnico"
              actions={
                <ExportButton
                  name="os-por-tecnico"
                  label="OS por técnico"
                  period={data.period}
                  header={['Técnico', 'Abertas', 'Concluídas', 'Tempo médio (horas)']}
                  rows={data.byTechnician.map((row) => [row.name ?? 'Sem técnico', row.opened, row.completed, hours(row.averageReadyMs)])}
                />
              }
            />
            <DataTable columns={columns} data={data.byTechnician} getRowId={(row) => row.technicianId ?? 'none'} empty={<TableEmpty>Nenhuma OS aberta ou concluída no período.</TableEmpty>} />
          </Card>
          <p className="text-xs text-muted">
            Concluída é a OS que chegou pela primeira vez a uma etapa de pronta ou entregue dentro do período. O tempo médio conta da abertura até essa chegada.
          </p>
        </>
      )}
    </ReportFrame>
  );
}
