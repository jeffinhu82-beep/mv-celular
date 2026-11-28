import { formatCsvMoney, formatDateTime, formatMoney, PAYMENT_METHOD_LABELS } from '@loja/shared';
import { useMemo, useState } from 'react';
import type { PeriodValue } from '@/components/filters/period-picker.tsx';
import { columnHelper, DataTable } from '@/components/ui/data-table.tsx';
import { Badge, Card, CardHeader } from '@/components/ui/misc.tsx';
import { DifferenceValue } from '@/features/cash/difference-value.tsx';
import { CashReportDialog } from '@/features/cash/report-dialog.tsx';
import { useAuth } from '@/lib/auth.tsx';
import type { CashClosingRow, FinanceReport, MethodRow } from '@/lib/types.ts';
import { ExportButton, Notice, ReportFrame, TableEmpty, useReport } from './shared.tsx';

type CostRow = NonNullable<FinanceReport['costs']>['byCategory'][number];

const costCol = columnHelper<CostRow>();
const feeCol = columnHelper<MethodRow>();
const closingCol = columnHelper<CashClosingRow>();
const VIEW_CASH = ['cash.open_close', 'cash.income', 'cash.withdrawal_expense', 'finance.view'] as const;

function TotalRow({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-sm">
      <span className="font-medium">{label}</span>
      <span className="num font-semibold">{formatMoney(cents)}</span>
    </div>
  );
}

export function FinanceReportTab({ period }: { period: PeriodValue }) {
  const query = useReport<FinanceReport>('/api/reports/finance', period);
  const [selected, setSelected] = useState<string | null>(null);
  const { canAny } = useAuth();
  const canOpenCash = canAny([...VIEW_CASH]);

  const costColumns = useMemo(
    () => [
      costCol.accessor('name', { header: 'Categoria' }),
      costCol.accessor('count', { header: 'Lançamentos', meta: { align: 'right', className: 'hidden sm:table-cell' } }),
      costCol.accessor('amountCents', { header: 'Valor', meta: { align: 'right' }, cell: (info) => <span className="num font-medium">{formatMoney(info.getValue())}</span> }),
    ],
    [],
  );

  const feeColumns = useMemo(
    () => [
      feeCol.accessor('method', { header: 'Forma', cell: (info) => PAYMENT_METHOD_LABELS[info.getValue()] }),
      feeCol.accessor('grossCents', { header: 'Bruto', meta: { align: 'right', className: 'hidden sm:table-cell' }, cell: (info) => <span className="num text-muted">{formatMoney(info.getValue())}</span> }),
      feeCol.accessor('feeCents', { header: 'Taxa', meta: { align: 'right' }, cell: (info) => <span className="num font-medium">{formatMoney(info.getValue() ?? 0)}</span> }),
    ],
    [],
  );

  const closingColumns = useMemo(
    () => [
      closingCol.accessor('closedAt', {
        header: 'Fechamento',
        cell: ({ row }) => (
          <div>
            <p className="num">{formatDateTime(row.original.closedAt)}</p>
            <p className="text-xs text-muted">{row.original.closedByName}</p>
          </div>
        ),
      }),
      closingCol.accessor('expectedCashCents', {
        header: 'Esperado',
        meta: { align: 'right', className: 'hidden sm:table-cell' },
        cell: (info) => <span className="num text-muted">{info.getValue() === null ? '—' : formatMoney(info.getValue()!)}</span>,
      }),
      closingCol.accessor('countedCashCents', {
        header: 'Contado',
        meta: { align: 'right', className: 'hidden sm:table-cell' },
        cell: (info) => <span className="num">{info.getValue() === null ? '—' : formatMoney(info.getValue()!)}</span>,
      }),
      closingCol.accessor('differenceCents', {
        header: 'Diferença',
        meta: { align: 'right' },
        cell: ({ row }) => (
          <div className="flex flex-col items-end gap-0.5">
            <DifferenceValue cents={row.original.differenceCents} />
            {row.original.status === 'open' && <Badge tone="info">Reaberto</Badge>}
          </div>
        ),
      }),
    ],
    [],
  );

  return (
    <ReportFrame query={query}>
      {(data) => (
        <>
          {!data.costs && <Notice>Custos e taxas aparecem só para quem vê o financeiro. Aqui ficam os fechamentos de caixa do período.</Notice>}
          {data.costs && data.fees && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader
                  title="Custos por categoria"
                  description="Despesas lançadas no caixa."
                  actions={
                    <ExportButton
                      name="custos-por-categoria"
                      label="custos por categoria"
                      period={data.period}
                      header={['Categoria', 'Lançamentos', 'Valor (R$)']}
                      rows={data.costs.byCategory.map((row) => [row.name, row.count, formatCsvMoney(row.amountCents)])}
                    />
                  }
                />
                <DataTable columns={costColumns} data={data.costs.byCategory} getRowId={(row) => row.categoryId ?? 'none'} empty={<TableEmpty>Nenhum custo registrado no período.</TableEmpty>} />
                {data.costs.byCategory.length > 0 && <TotalRow label="Total de custos" cents={data.costs.totalCents} />}
              </Card>
              <Card>
                <CardHeader
                  title="Taxas por forma de pagamento"
                  description="Quanto cada forma descontou do valor bruto."
                  actions={
                    <ExportButton
                      name="taxas-por-forma"
                      label="taxas por forma"
                      period={data.period}
                      header={['Forma', 'Bruto (R$)', 'Taxa (R$)']}
                      rows={data.fees.byMethod.map((row) => [PAYMENT_METHOD_LABELS[row.method], formatCsvMoney(row.grossCents), formatCsvMoney(row.feeCents ?? 0)])}
                    />
                  }
                />
                <DataTable columns={feeColumns} data={data.fees.byMethod} getRowId={(row) => row.method} empty={<TableEmpty>Nenhuma taxa no período.</TableEmpty>} />
                {data.fees.byMethod.length > 0 && <TotalRow label="Total de taxas" cents={data.fees.totalCents} />}
              </Card>
            </div>
          )}
          <Card>
            <CardHeader
              title="Fechamentos de caixa"
              description={canOpenCash ? 'Clique em um fechamento para ver o relatório completo.' : undefined}
              actions={
                <ExportButton
                  name="fechamentos-de-caixa"
                  label="fechamentos de caixa"
                  period={data.period}
                  header={['Abertura', 'Aberto por', 'Fechamento', 'Fechado por', 'Fundo (R$)', 'Esperado (R$)', 'Contado (R$)', 'Diferença (R$)', 'Observação']}
                  rows={data.closings.map((row) => [
                    formatDateTime(row.openedAt),
                    row.openedByName,
                    formatDateTime(row.closedAt),
                    row.closedByName,
                    formatCsvMoney(row.openingCents),
                    formatCsvMoney(row.expectedCashCents),
                    formatCsvMoney(row.countedCashCents),
                    formatCsvMoney(row.differenceCents),
                    row.notes ?? '',
                  ])}
                />
              }
            />
            <DataTable
              columns={closingColumns}
              data={data.closings}
              getRowId={(row) => row.id}
              onRowClick={canOpenCash ? (row) => setSelected(row.id) : undefined}
              empty={<TableEmpty>Nenhum caixa fechado no período.</TableEmpty>}
            />
          </Card>
          <CashReportDialog sessionId={selected} onOpenChange={(open) => !open && setSelected(null)} />
        </>
      )}
    </ReportFrame>
  );
}
