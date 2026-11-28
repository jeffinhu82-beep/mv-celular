import { formatDate, formatMoney, formatPhoneBR, formatRelativeDays } from '@loja/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { columnHelper, DataTable } from '@/components/ui/data-table.tsx';
import { Badge, Card, EmptyState, Stat } from '@/components/ui/misc.tsx';
import { api } from '@/lib/api.ts';
import type { ReceivablesList } from '@/lib/types.ts';
import { plural } from '@/lib/utils.ts';

type ReceivableRow = ReceivablesList['items'][number];

const col = columnHelper<ReceivableRow>();

export function useReceivables() {
  return useQuery({ queryKey: ['receivables'], queryFn: () => api.get<ReceivablesList>('/api/receivables') });
}

export function ReceivablesTab() {
  const navigate = useNavigate();
  const receivables = useReceivables();
  const data = receivables.data;
  const items = data?.items ?? [];
  const osCount = items.filter((item) => item.kind === 'os').length;

  const columns = useMemo(
    () => [
      col.accessor('kind', {
        header: 'Origem',
        meta: { className: 'hidden md:table-cell' },
        cell: (info) => <Badge tone={info.getValue() === 'os' ? 'info' : 'neutral'}>{info.getValue() === 'os' ? 'OS pronta' : 'Venda pendente'}</Badge>,
      }),
      col.accessor('number', {
        header: 'Número',
        cell: (info) => (
          <div>
            <p className="num font-medium">{info.getValue()}</p>
            <p className="text-xs text-muted md:hidden">{info.row.original.kind === 'os' ? 'OS pronta' : 'Venda pendente'}</p>
            <p className="sm:hidden">{info.row.original.customer?.name ?? 'Consumidor'}</p>
          </div>
        ),
      }),
      col.accessor((row) => row.customer?.name ?? 'Consumidor', {
        id: 'customer',
        header: 'Cliente',
        meta: { className: 'hidden sm:table-cell' },
        cell: (info) => (
          <div>
            <p>{info.getValue()}</p>
            {info.row.original.customer?.phoneE164 && <p className="num text-xs text-muted">{formatPhoneBR(info.row.original.customer.phoneE164)}</p>}
          </div>
        ),
      }),
      col.accessor('label', { header: 'Descrição', meta: { className: 'hidden xl:table-cell' }, cell: (info) => <span className="block max-w-72 truncate text-muted">{info.getValue()}</span> }),
      col.accessor('since', {
        header: 'Desde',
        meta: { className: 'hidden sm:table-cell' },
        cell: (info) => (
          <span title={formatDate(info.getValue())} className="whitespace-nowrap">
            {formatRelativeDays(info.getValue())}
          </span>
        ),
      }),
      col.accessor('balanceCents', { header: 'Saldo', meta: { align: 'right' }, cell: (info) => <span className="num font-semibold text-warning">{formatMoney(info.getValue())}</span> }),
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total a receber" value={formatMoney(data?.totalCents ?? 0)} tone={(data?.totalCents ?? 0) > 0 ? 'warning' : undefined} />
        <Stat label="Vendas pendentes" value={String((data?.count ?? 0) - osCount)} />
        <Stat label="OS prontas com saldo" value={String(osCount)} />
      </div>
      <Card className="p-0">
        <DataTable
          columns={columns}
          data={items}
          loading={receivables.isLoading}
          getRowId={(row) => `${row.kind}-${row.id}`}
          onRowClick={(row) => navigate(row.kind === 'sale' ? `/vendas/${row.id}` : `/os/${row.id}`)}
          empty={<EmptyState title="Nada a receber" description="Vendas com saldo pendente e OS prontas com saldo aparecem aqui." />}
        />
      </Card>
      {data && data.count > items.length && <p className="text-xs text-muted">Mostrando {plural(items.length, 'pendência', 'pendências')} de {data.count}.</p>}
    </div>
  );
}
