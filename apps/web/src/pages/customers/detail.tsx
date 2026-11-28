import { formatCpf, formatDate, formatMoney, formatPhoneBR, SALE_ORIGIN_LABELS, SALE_STATUS_LABELS, whatsappLink, type SaleOrigin, type SaleStatus, type StageType } from '@loja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, Download, MessageCircle, MoreHorizontal, Pencil, Receipt, ShieldOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { SectionLoader } from '@/components/layout/loader.tsx';
import { Button } from '@/components/ui/button.tsx';
import { columnHelper, DataTable } from '@/components/ui/data-table.tsx';
import { ConfirmDialog } from '@/components/ui/dialog.tsx';
import {
  Badge,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Stat,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/misc.tsx';
import { CustomerFormDialog } from '@/features/customers/customer-form.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';
import type { Customer } from '@/lib/types.ts';
import { useToast } from '@/lib/toast.tsx';
import { NotFoundPage } from '../errors.tsx';

interface CustomerSale {
  id: string;
  number: string | null;
  status: SaleStatus;
  origin: SaleOrigin;
  totalCents: number;
  paidCents: number;
  completedAt: string | null;
  createdAt: string;
}

interface CustomerOs {
  id: string;
  number: string;
  device: string;
  reportedIssue: string;
  column: { name: string; stageType: StageType; color: string };
  totalCents: number;
  balanceCents: number;
  deliveredAt: string | null;
  warrantyUntil: string | null;
  createdAt: string;
}

interface CustomerDetail {
  customer: Customer;
  sales: CustomerSale[];
  serviceOrders: CustomerOs[];
  totals: { totalSpentCents: number; pendingCents: number; activeWarranties: number };
}

const saleCol = columnHelper<CustomerSale>();
const osCol = columnHelper<CustomerOs>();

const SALE_TONES: Record<SaleStatus, 'success' | 'warning' | 'muted' | 'info'> = {
  completed: 'success',
  pending: 'warning',
  cancelled: 'muted',
  quote: 'info',
};

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);

  const detail = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<CustomerDetail>(`/api/customers/${id}`) });

  const anonymize = useMutation({
    mutationFn: () => api.post(`/api/customers/${id}/anonymize`),
    onSuccess: async () => {
      setAnonymizing(false);
      toast.success('Dados pessoais removidos', 'O histórico financeiro foi mantido.');
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['customer', id] });
    },
    onError: (error) => toast.error('Não foi possível anonimizar', errorMessage(error)),
  });

  const exportData = async () => {
    try {
      const data = await api.get<unknown>(`/api/customers/${id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cliente-${id}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Não foi possível exportar', errorMessage(error));
    }
  };

  const saleColumns = useMemo(
    () => [
      saleCol.accessor('number', {
        header: 'Venda',
        cell: (info) => {
          const sale = info.row.original;
          const open = sale.status === 'pending' ? sale.totalCents - sale.paidCents : 0;
          return (
            <div>
              <p className="num font-medium">{info.getValue() ?? '—'}</p>
              <p className="num text-xs text-muted sm:hidden">{formatDate(sale.completedAt ?? sale.createdAt)}</p>
              {(sale.status !== 'completed' || open > 0) && (
                <span className="mt-1 inline-flex flex-wrap items-center gap-1.5 sm:hidden">
                  <Badge tone={SALE_TONES[sale.status]}>{SALE_STATUS_LABELS[sale.status]}</Badge>
                  {open > 0 && <span className="num text-xs text-warning">falta {formatMoney(open)}</span>}
                </span>
              )}
            </div>
          );
        },
      }),
      saleCol.accessor('createdAt', { header: 'Data', meta: { className: 'hidden sm:table-cell' }, cell: (info) => <span className="num text-muted">{formatDate(info.row.original.completedAt ?? info.getValue())}</span> }),
      saleCol.accessor('origin', { header: 'Origem', meta: { className: 'hidden md:table-cell' }, cell: (info) => SALE_ORIGIN_LABELS[info.getValue()] }),
      saleCol.accessor('status', { header: 'Situação', meta: { className: 'hidden sm:table-cell' }, cell: (info) => <Badge tone={SALE_TONES[info.getValue()]}>{SALE_STATUS_LABELS[info.getValue()]}</Badge> }),
      saleCol.accessor('totalCents', { header: 'Total', meta: { align: 'right' }, cell: (info) => formatMoney(info.getValue()) }),
      saleCol.display({
        id: 'balance',
        header: 'Em aberto',
        meta: { align: 'right', className: 'hidden sm:table-cell' },
        cell: (info) => {
          const sale = info.row.original;
          const open = sale.status === 'pending' ? sale.totalCents - sale.paidCents : 0;
          return open > 0 ? <span className="text-warning">{formatMoney(open)}</span> : <span className="text-muted">—</span>;
        },
      }),
    ],
    [],
  );

  const osColumns = useMemo(
    () => [
      osCol.accessor('number', {
        header: 'OS',
        cell: (info) => (
          <div>
            <p className="num font-medium">{info.getValue()}</p>
            <p className="sm:hidden">{info.row.original.device}</p>
          </div>
        ),
      }),
      osCol.accessor('device', { header: 'Aparelho', meta: { className: 'hidden sm:table-cell' } }),
      osCol.accessor('column', {
        header: 'Etapa',
        cell: (info) => (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: info.getValue().color }} aria-hidden />
            {info.getValue().name}
          </span>
        ),
      }),
      osCol.accessor('createdAt', { header: 'Entrada', meta: { className: 'hidden md:table-cell' }, cell: (info) => <span className="num text-muted">{formatDate(info.getValue())}</span> }),
      osCol.accessor('warrantyUntil', {
        header: 'Garantia',
        meta: { className: 'hidden md:table-cell' },
        cell: (info) => {
          const value = info.getValue();
          if (!value) return <span className="text-muted">—</span>;
          const active = new Date(value) > new Date();
          return <Badge tone={active ? 'success' : 'muted'}>{active ? `até ${formatDate(value)}` : 'vencida'}</Badge>;
        },
      }),
      osCol.accessor('totalCents', { header: 'Total', meta: { align: 'right' }, cell: (info) => formatMoney(info.getValue()) }),
    ],
    [],
  );

  if (detail.isPending) return <SectionLoader />;
  if (detail.error instanceof ApiError && detail.error.status === 404) return <NotFoundPage />;
  if (!detail.data) return <EmptyState title="Não foi possível carregar o cliente" description={errorMessage(detail.error)} />;

  const { customer, sales, serviceOrders, totals } = detail.data;
  const anonymized = Boolean(customer.anonymizedAt);
  const whats = whatsappLink(customer.phoneE164, '');

  return (
    <>
      <div className="mb-4">
        <Link to="/clientes" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft className="size-4" /> Clientes
        </Link>
      </div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{customer.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {customer.phoneE164 && <span className="num">{formatPhoneBR(customer.phoneE164)}</span>}
            {customer.cpf && <span className="num">CPF {formatCpf(customer.cpf)}</span>}
            {customer.email && <span>{customer.email}</span>}
            {anonymized && <Badge tone="muted">Anonimizado em {formatDate(customer.anonymizedAt!)}</Badge>}
          </div>
          {customer.address && <p className="mt-1 text-sm text-muted">{customer.address}</p>}
        </div>
        {!anonymized && (
          <div className="flex flex-wrap gap-2">
            {whats && (
              <Button asChild variant="secondary">
                <a href={whats} target="_blank" rel="noreferrer">
                  <MessageCircle /> WhatsApp
                </a>
              </Button>
            )}
            {can('customer.manage') && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil /> Editar
              </Button>
            )}
            {can('customer.privacy') && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Mais ações">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={exportData}>
                    <Download /> Exportar dados (LGPD)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setAnonymizing(true)} className="text-primary-text">
                    <ShieldOff /> Anonimizar
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>

      {customer.notes && (
        <Card className="mb-4 p-4 text-sm">
          <p className="mb-1 text-xs font-medium text-muted">Observações</p>
          <p className="whitespace-pre-wrap">{customer.notes}</p>
        </Card>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total gasto" value={formatMoney(totals.totalSpentCents)} />
        <Stat label="Pendente" value={formatMoney(totals.pendingCents)} tone={totals.pendingCents > 0 ? 'warning' : undefined} />
        <Stat label="Garantias ativas" value={totals.activeWarranties} tone={totals.activeWarranties > 0 ? 'success' : undefined} />
        <Stat label="Ordens de serviço" value={serviceOrders.length} />
      </div>

      <Tabs defaultValue={serviceOrders.length > sales.length ? 'os' : 'sales'}>
        <TabsList>
          <TabsTrigger value="sales">Compras ({sales.length})</TabsTrigger>
          <TabsTrigger value="os">Ordens de serviço ({serviceOrders.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="sales">
          <Card>
            <DataTable
              columns={saleColumns}
              data={sales}
              getRowId={(row) => row.id}
              onRowClick={(row) => navigate(`/vendas/${row.id}`)}
              empty={<EmptyState icon={Receipt} title="Nenhuma compra ainda" description="As vendas feitas para este cliente aparecem aqui." />}
            />
          </Card>
        </TabsContent>
        <TabsContent value="os">
          <Card>
            <DataTable
              columns={osColumns}
              data={serviceOrders}
              getRowId={(row) => row.id}
              onRowClick={(row) => navigate(`/os/${row.id}`)}
              empty={<EmptyState icon={ClipboardList} title="Nenhuma OS ainda" description="Abra uma ordem de serviço quando o cliente trouxer um aparelho." />}
            />
          </Card>
        </TabsContent>
      </Tabs>

      <CustomerFormDialog open={editing} onOpenChange={setEditing} customer={customer} />
      <ConfirmDialog
        open={anonymizing}
        onOpenChange={setAnonymizing}
        title="Anonimizar cliente?"
        description="Nome, telefone, CPF, e-mail, endereço e senhas de aparelho serão apagados. Vendas e OS continuam no histórico, sem identificar a pessoa. Não dá para desfazer."
        confirmLabel="Anonimizar"
        destructive
        loading={anonymize.isPending}
        onConfirm={() => anonymize.mutate()}
      />
    </>
  );
}
