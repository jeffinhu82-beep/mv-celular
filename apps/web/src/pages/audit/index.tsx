import { AUDIT_GROUPS, auditActionLabel, auditRecordLabel, formatDateTime } from '@loja/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PeriodPicker, periodQuery, readPeriod } from '@/components/filters/period-picker.tsx';
import { columnHelper, DataTable, Pagination } from '@/components/ui/data-table.tsx';
import { NativeSelect } from '@/components/ui/input.tsx';
import { Card, EmptyState, PageHeader } from '@/components/ui/misc.tsx';
import { AuditDetailsDialog } from '@/features/audit/details-dialog.tsx';
import { api } from '@/lib/api.ts';
import { useSearchState } from '@/lib/hooks.ts';
import type { AuditEntry, AuditPage as AuditList } from '@/lib/types.ts';
import { cn, plural, toQuery } from '@/lib/utils.ts';

const PAGE_SIZE = 50;
const auditCol = columnHelper<AuditEntry>();

interface AuditUser {
  id: string;
  name: string;
  active: boolean;
}

export function AuditPage() {
  const [params, update] = useSearchState();
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const period = readPeriod(params, 'month');
  const page = Math.max(1, Number(params.get('page')) || 1);
  const action = params.get('acao') ?? '';
  const userId = params.get('usuario') ?? '';

  const users = useQuery({ queryKey: ['audit', 'users'], queryFn: () => api.get<AuditUser[]>('/api/audit/users'), staleTime: 5 * 60_000 });
  const query = { ...periodQuery(period), action, userId, page, pageSize: PAGE_SIZE };
  const entries = useQuery({ queryKey: ['audit', 'list', query], queryFn: () => api.get<AuditList>(`/api/audit${toQuery(query)}`), placeholderData: keepPreviousData });
  const filtered = Boolean(action || userId);

  const columns = useMemo(
    () => [
      auditCol.accessor('createdAt', { header: 'Quando', cell: (info) => <span className="num whitespace-nowrap text-muted">{formatDateTime(info.getValue())}</span> }),
      auditCol.accessor('userName', {
        header: 'Quem',
        meta: { className: 'hidden sm:table-cell' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="whitespace-nowrap">{row.original.userName ?? <span className="text-muted">Sistema</span>}</p>
            {row.original.approvedByName && <p className="text-xs whitespace-nowrap text-muted">autorizado por {row.original.approvedByName}</p>}
          </div>
        ),
      }),
      auditCol.accessor('action', {
        header: 'Ação',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{auditActionLabel(row.original.action)}</p>
            <p className="text-xs text-muted sm:hidden">{row.original.userName ?? 'Sistema'}</p>
          </div>
        ),
      }),
      auditCol.display({
        id: 'record',
        header: 'Registro',
        meta: { className: 'hidden md:table-cell' },
        cell: ({ row }) => <span className="block max-w-56 truncate text-muted">{auditRecordLabel(row.original.entity, row.original.before, row.original.after)}</span>,
      }),
      auditCol.accessor('ip', { header: 'IP', meta: { className: 'hidden lg:table-cell' }, cell: (info) => <span className="num text-muted">{info.getValue() ?? '—'}</span> }),
    ],
    [],
  );

  return (
    <div>
      <PageHeader title="Auditoria" description="Quem fez o quê, quando e de onde. Os registros não podem ser editados nem apagados." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PeriodPicker value={period} onChange={(value) => update({ from: null, to: null, ...periodQuery(value) })} />
            {entries.data && (
              <p className="text-sm text-muted" aria-live="polite">
                {plural(entries.data.total, 'registro', 'registros')}
              </p>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:max-w-2xl">
            <NativeSelect aria-label="Tipo de ação" value={action} onChange={(event) => update({ acao: event.target.value })}>
              <option value="">Todas as ações</option>
              {AUDIT_GROUPS.map((group) => (
                <option key={group.prefix} value={group.prefix}>
                  {group.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Usuário" value={userId} onChange={(event) => update({ usuario: event.target.value })}>
              <option value="">Todas as pessoas</option>
              {users.data?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.active ? user.name : `${user.name} (inativo)`}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <DataTable
          columns={columns}
          data={entries.data?.items ?? []}
          loading={entries.isPending}
          getRowId={(row) => row.id}
          onRowClick={setSelected}
          className={cn('transition-opacity', entries.isPlaceholderData && 'opacity-60')}
          empty={
            <EmptyState
              icon={ShieldCheck}
              title={filtered ? 'Nenhum registro com esses filtros' : 'Nenhum registro no período'}
              description={filtered ? 'Troque o tipo de ação, a pessoa ou o período.' : 'Escolha outro período para ver ações mais antigas.'}
            />
          }
        />
        {entries.data && <Pagination page={page} pageSize={PAGE_SIZE} total={entries.data.total} onPageChange={(next) => update({ page: String(next) })} />}
      </Card>
      <AuditDetailsDialog entry={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}
