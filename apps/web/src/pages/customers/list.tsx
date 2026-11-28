import { formatCpf, formatDate, formatPhoneBR } from '@loja/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, UserSquare2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button.tsx';
import { columnHelper, DataTable, Pagination } from '@/components/ui/data-table.tsx';
import { SearchInput } from '@/components/ui/masked.tsx';
import { Card, EmptyState, PageHeader } from '@/components/ui/misc.tsx';
import { CustomerFormDialog } from '@/features/customers/customer-form.tsx';
import { api } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';
import { useDebounced } from '@/lib/hooks.ts';
import type { Customer, Paged } from '@/lib/types.ts';
import { toQuery } from '@/lib/utils.ts';

const PAGE_SIZE = 30;
const col = columnHelper<Customer>();

export function CustomersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(q.trim());

  const customers = useQuery({
    queryKey: ['customers', { q: debounced, page }],
    queryFn: () => api.get<Paged<Customer>>(`/api/customers${toQuery({ q: debounced, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo(
    () => [
      col.accessor('name', { header: 'Nome', cell: (info) => <span className="font-medium">{info.getValue()}</span> }),
      col.accessor('phoneE164', { header: 'WhatsApp', cell: (info) => <span className="num">{formatPhoneBR(info.getValue())}</span> }),
      col.accessor('cpf', { header: 'CPF', meta: { className: 'hidden md:table-cell' }, cell: (info) => <span className="num text-muted">{info.getValue() ? formatCpf(info.getValue()) : '—'}</span> }),
      col.accessor('createdAt', { header: 'Cadastro', meta: { className: 'hidden sm:table-cell' }, cell: (info) => <span className="num text-muted">{formatDate(info.getValue())}</span> }),
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Busque por nome, telefone ou CPF."
        actions={
          can('customer.manage') && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus /> Novo cliente
            </Button>
          )
        }
      />
      <Card>
        <div className="border-b border-border p-3">
          <SearchInput
            value={q}
            onValueChange={(value) => {
              setQ(value);
              setPage(1);
            }}
            placeholder="Nome, telefone ou CPF"
            className="max-w-md"
            autoFocus
          />
        </div>
        <DataTable
          columns={columns}
          data={customers.data?.items ?? []}
          loading={customers.isPending}
          getRowId={(row) => row.id}
          onRowClick={(row) => navigate(`/clientes/${row.id}`)}
          empty={
            <EmptyState
              icon={UserSquare2}
              title={debounced ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado ainda'}
              description={debounced ? 'Confira a grafia ou busque pelo telefone.' : 'Cadastre o primeiro cliente para usar em vendas e OS.'}
              action={
                can('customer.manage') && (
                  <Button variant="secondary" onClick={() => setCreating(true)}>
                    <Plus /> Cadastrar cliente
                  </Button>
                )
              }
            />
          }
        />
        <Pagination page={page} pageSize={PAGE_SIZE} total={customers.data?.total ?? 0} onPageChange={setPage} />
      </Card>
      <CustomerFormDialog open={creating} onOpenChange={setCreating} initialName={/\d/.test(q) ? '' : q} onSaved={(customer) => navigate(`/clientes/${customer.id}`)} />
    </>
  );
}
