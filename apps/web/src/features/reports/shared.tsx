import { dayKey } from '@loja/shared';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Download, Info, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { periodQuery, type PeriodValue } from '@/components/filters/period-picker.tsx';
import { SectionLoader } from '@/components/layout/loader.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, EmptyState } from '@/components/ui/misc.tsx';
import { api, errorMessage } from '@/lib/api.ts';
import { downloadText, toCsv } from '@/lib/csv.ts';
import type { ReportPeriod } from '@/lib/types.ts';
import { cn, toQuery } from '@/lib/utils.ts';

export function useReport<T>(path: string, period: PeriodValue) {
  const query = periodQuery(period);
  return useQuery({
    queryKey: ['reports', path, query],
    queryFn: () => api.get<T>(`${path}${toQuery(query)}`),
    placeholderData: keepPreviousData,
  });
}

export function ReportFrame<T>({ query, children }: { query: UseQueryResult<T>; children(data: T): ReactNode }) {
  if (query.data) {
    return (
      <div className={cn('flex flex-col gap-4 transition-opacity', query.isPlaceholderData && 'opacity-60')} aria-busy={query.isPlaceholderData}>
        {children(query.data)}
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        title="Não foi possível carregar o relatório"
        description={errorMessage(query.error)}
        action={
          <Button variant="outline" onClick={() => query.refetch()}>
            <RefreshCw /> Tentar de novo
          </Button>
        }
      />
    );
  }
  return <SectionLoader />;
}

export interface FigureItem {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}

export function FigureBand({ items }: { items: FigureItem[] }) {
  return (
    <Card className="overflow-hidden">
      <dl className={cn('grid gap-px bg-border', items.length === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3')}>
        {items.map((item) => (
          <div key={item.label} className="bg-surface p-4">
            <dt className="text-xs font-medium text-muted">{item.label}</dt>
            <dd className="num mt-1 text-xl font-semibold tracking-tight">{item.value}</dd>
            {item.hint && <dd className="mt-0.5 text-xs text-muted">{item.hint}</dd>}
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function periodFileSuffix(period: ReportPeriod): string {
  const from = dayKey(new Date(period.start));
  const to = dayKey(new Date(new Date(period.end).getTime() - 1));
  return from === to ? from : `${from}_a_${to}`;
}

export function dayLabel(key: string): string {
  return key.split('-').reverse().join('/');
}

export function ExportButton({ name, label, period, header, rows }: { name: string; label: string; period: ReportPeriod; header: string[]; rows: unknown[][] }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={rows.length === 0}
      aria-label={`Exportar ${label} em CSV`}
      onClick={() => downloadText(`${name}_${periodFileSuffix(period)}.csv`, toCsv(header, rows))}
      className="-my-1 -mr-2 text-muted hover:text-text"
    >
      <Download /> CSV
    </Button>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-muted">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function TableEmpty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted">{children}</p>;
}
