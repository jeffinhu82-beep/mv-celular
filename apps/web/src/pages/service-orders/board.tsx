import { dayKey, formatDate, formatMoney } from '@loja/shared';
import { AlarmClock, Columns3, Hourglass, List, MessageCircle, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useStoreSettings } from '@/components/layout/app-shell.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { columnHelper, DataTable } from '@/components/ui/data-table.tsx';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Input, NativeSelect } from '@/components/ui/input.tsx';
import { SearchInput } from '@/components/ui/masked.tsx';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc.tsx';
import { StageDot } from '@/features/dashboard/shared.tsx';
import type { CardActions } from '@/features/service-orders/card.tsx';
import { OsDetailSheet } from '@/features/service-orders/detail.tsx';
import { OsPrintDialog } from '@/features/service-orders/documents.tsx';
import { Kanban } from '@/features/service-orders/kanban.tsx';
import { DeliverFlow } from '@/features/service-orders/os-actions.tsx';
import { OsFormDialog } from '@/features/service-orders/os-form.tsx';
import { useBoard, useRefreshServiceOrders, type BoardFilters } from '@/features/service-orders/queries.ts';
import { BalanceBadge, deviceLabel, FlagBadges, GENERIC_OS_TEMPLATE, osMessage, TechAvatar, useOsWhatsapp } from '@/features/service-orders/shared.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';
import { useSearchState, useSearchText } from '@/lib/hooks.ts';
import { useToast } from '@/lib/toast.tsx';
import type { BoardColumn, ServiceOrderCard, ServiceOrderDetail } from '@/lib/types.ts';
import { cn } from '@/lib/utils.ts';

type Movable = Pick<ServiceOrderCard, 'id' | 'number' | 'columnId'>;

interface PendingCancel {
  os: Movable;
  target: BoardColumn;
  afterId: string | null | undefined;
}

interface PendingNotice {
  os: ServiceOrderDetail;
  column: BoardColumn;
  message: string;
}

const PERIOD_OPTIONS = [
  { value: '', label: 'Qualquer data de entrada' },
  { value: 'today', label: 'Entrada hoje' },
  { value: 'yesterday', label: 'Entrada ontem' },
  { value: 'month', label: 'Entrada este mês' },
  { value: 'range', label: 'Entrada no intervalo' },
];

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function readFilters(params: URLSearchParams): BoardFilters {
  const today = dayKey(new Date());
  const period = params.get('period') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  return {
    technicianId: params.get('tecnico') ?? '',
    q: params.get('q') ?? '',
    late: params.get('atrasadas') === '1',
    stale: params.get('paradas') === '1',
    period: PERIOD_OPTIONS.some((option) => option.value === period) ? period : '',
    from: DAY_KEY.test(from) ? from : today,
    to: DAY_KEY.test(to) ? to : today,
    all: params.get('todas') === '1',
  };
}

const listCol = columnHelper<ServiceOrderCard & { column: BoardColumn }>();

export function ServiceOrdersPage() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { id: openId } = useParams();
  const settings = useStoreSettings();
  const refresh = useRefreshServiceOrders();
  const openWhatsapp = useOsWhatsapp();
  const [params, update] = useSearchState();
  const filters = readFilters(params);
  const view = params.get('ver') === 'lista' ? 'list' : 'board';
  const board = useBoard(filters);
  const [search, setSearch] = useSearchText(filters.q, (value) => update({ q: value || null }));
  const [creating, setCreating] = useState(false);
  const [entryPrint, setEntryPrint] = useState<ServiceOrderDetail | null>(null);
  const [delivering, setDelivering] = useState<string | null>(null);
  const [pendingCancel, setPendingCancel] = useState<PendingCancel | null>(null);
  const [notice, setNotice] = useState<PendingNotice | null>(null);

  const data = board.data;
  const columns = data?.columns ?? [];
  const staff = data?.staff ?? [];
  const now = useMemo(() => (data ? new Date(data.now) : new Date()), [data]);
  const staleDays = data?.staleOsDays ?? settings.data?.staleOsDays ?? 5;
  const canMove = can('os.move');
  const canDeliver = can('sale.create');
  const query = location.search;

  const openDetail = useCallback((id: string) => navigate(`/os/${id}${query}`), [navigate, query]);
  const closeDetail = useCallback(() => navigate(`/os${query}`), [navigate, query]);
  const closeDeliver = useCallback(() => setDelivering(null), []);

  const resync = () => void board.refetch();

  const performMove = async (os: Movable, target: BoardColumn, afterId: string | null | undefined) => {
    try {
      const result = await api.post<ServiceOrderDetail>(`/api/service-orders/${os.id}/move`, { columnId: target.id, ...(afterId !== undefined ? { afterId } : {}) });
      refresh(result);
      if (result.moved && target.whatsappEnabled && target.whatsappTrigger === 'on_move' && target.template && result.customer.phoneE164 && !result.customer.anonymizedAt) {
        setNotice({ os: result, column: target, message: osMessage(target.template.body, result, settings.data) });
      } else if (result.moved) {
        toast.success(`${result.number} em ${target.name}`);
      }
    } catch (error) {
      resync();
      if (error instanceof ApiError && error.code === 'APPROVAL_CANCELLED') return;
      toast.error(`Não foi possível mover a ${os.number}`, errorMessage(error));
    }
  };

  const requestMove = async (os: Movable, target: BoardColumn, afterId: string | null | undefined) => {
    const current = columns.find((column) => column.id === os.columnId);
    if (target.stageType === 'done') {
      resync();
      if (current?.stageType === 'ready' && canDeliver) setDelivering(os.id);
      else toast.info('A entrega é feita pelo "Receber e entregar"', 'Mova a OS para "Pronto para retirada" e use o botão do card.');
      return;
    }
    if (target.stageType === 'cancelled') {
      setPendingCancel({ os, target, afterId });
      return;
    }
    await performMove(os, target, afterId);
  };

  const actions: CardActions = {
    open: (card) => openDetail(card.id),
    whatsapp: (card, column) => {
      const template = column.whatsappEnabled && column.template ? column.template.body : GENERIC_OS_TEMPLATE;
      if (!openWhatsapp(card.id, card.customer.phoneE164, osMessage(template, card, settings.data), 'manual')) toast.error('Cliente sem WhatsApp válido');
    },
    deliver: (card) => setDelivering(card.id),
    moveTo: (card, column) => void requestMove(card, column, undefined),
  };

  const sendNotice = () => {
    if (!notice) return;
    if (!openWhatsapp(notice.os.id, notice.os.customer.phoneE164, notice.message, 'on_move')) toast.error('Cliente sem WhatsApp válido');
    setNotice(null);
  };

  const listRows = useMemo(() => columns.flatMap((column) => column.cards.map((card) => ({ ...card, column }))), [columns]);
  const listColumns = useMemo(
    () => [
      listCol.accessor('number', {
        header: 'OS',
        cell: ({ row }) => (
          <div>
            <p className="num font-medium">{row.original.number}</p>
            <p className="md:hidden">{row.original.customer.name}</p>
            <p className="text-xs text-muted md:hidden">{deviceLabel(row.original)}</p>
            <div className="mt-1 flex flex-wrap gap-1 empty:hidden 2xl:hidden">
              <FlagBadges flags={row.original.flags} staleDays={staleDays} />
            </div>
          </div>
        ),
      }),
      listCol.accessor((row) => row.customer.name, {
        id: 'customer',
        header: 'Cliente',
        meta: { className: 'hidden md:table-cell' },
        cell: (info) => (
          <div>
            <p>{info.getValue()}</p>
            <p className="text-xs text-muted xl:hidden">{deviceLabel(info.row.original)}</p>
          </div>
        ),
      }),
      listCol.accessor((row) => deviceLabel(row), {
        id: 'device',
        header: 'Aparelho',
        meta: { className: 'hidden xl:table-cell' },
        cell: (info) => (
          <div className="max-w-48 2xl:max-w-56">
            <p className="truncate">{info.getValue()}</p>
            <p className="truncate text-xs text-muted">{info.row.original.reportedIssue}</p>
          </div>
        ),
      }),
      listCol.accessor((row) => row.column.name, {
        id: 'column',
        header: 'Coluna',
        cell: (info) => (
          <span className="flex items-center gap-1.5 2xl:whitespace-nowrap">
            <StageDot color={info.row.original.column.color} /> {info.getValue()}
          </span>
        ),
      }),
      listCol.accessor('technicianName', {
        header: 'Técnico',
        meta: { className: 'hidden xl:table-cell' },
        cell: (info) => (
          <span className="flex items-center gap-1.5 2xl:whitespace-nowrap">
            <TechAvatar name={info.getValue()} /> {info.getValue() ?? <span className="text-muted">—</span>}
          </span>
        ),
      }),
      listCol.display({ id: 'flags', header: 'Alertas', meta: { className: 'hidden 2xl:table-cell' }, cell: (info) => <div className="flex min-w-28 max-w-44 flex-wrap gap-1"><FlagBadges flags={info.row.original.flags} staleDays={staleDays} /></div> }),
      listCol.accessor('dueAt', { header: 'Previsão', meta: { className: 'hidden sm:table-cell' }, cell: (info) => (info.getValue() ? formatDate(info.getValue()!) : <span className="text-muted">—</span>) }),
      listCol.accessor('totalCents', {
        header: 'Total',
        meta: { align: 'right', className: 'hidden sm:table-cell' },
        cell: (info) => (
          <div className="flex flex-col items-end gap-1">
            <span className="num">{info.getValue() > 0 ? formatMoney(info.getValue()) : '—'}</span>
            <BalanceBadge totalCents={info.getValue()} balanceCents={info.row.original.balanceCents} paidCents={info.row.original.paidCents} />
          </div>
        ),
      }),
    ],
    [staleDays],
  );

  const activeFilters = Boolean(filters.technicianId || filters.q || filters.late || filters.stale || filters.period || filters.all);
  const totalCards = columns.reduce((sum, column) => sum + column.count, 0);

  return (
    <>
      <PageHeader
        title="Ordens de serviço"
        description="Arraste os cards entre as colunas ou use o menu de cada card."
        actions={
          <>
            <Segmented
              label="Visualização"
              value={view}
              onChange={(value) => update({ ver: value === 'list' ? 'lista' : null })}
              options={[
                { value: 'board', label: <span className="flex items-center gap-1.5"><Columns3 className="size-4" /> Quadro</span> },
                { value: 'list', label: <span className="flex items-center gap-1.5"><List className="size-4" /> Lista</span> },
              ]}
            />
            {can('os.edit') && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus /> Nova OS
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <SearchInput value={search} onValueChange={setSearch} placeholder="Número, cliente, telefone, aparelho ou IMEI" className="lg:w-80" aria-label="Buscar OS" />
        <div className="flex flex-wrap items-center gap-2">
          {can('os.view_all') && (
            <NativeSelect value={filters.technicianId} onChange={(event) => update({ tecnico: event.target.value || null })} aria-label="Técnico" className="w-auto">
              <option value="">Todos os técnicos</option>
              <option value="none">Sem técnico</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </NativeSelect>
          )}
          <ToggleChip active={filters.late} onClick={() => update({ atrasadas: filters.late ? null : '1' })}>
            <AlarmClock className="size-3.5" /> Atrasadas
          </ToggleChip>
          <ToggleChip active={filters.stale} onClick={() => update({ paradas: filters.stale ? null : '1' })}>
            <Hourglass className="size-3.5" /> Paradas há {staleDays}+ dias
          </ToggleChip>
          <NativeSelect value={filters.period} onChange={(event) => update({ period: event.target.value || null, from: null, to: null })} aria-label="Data de entrada" className="w-auto">
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
          {filters.period === 'range' && (
            <div className="flex items-center gap-2">
              <Input type="date" aria-label="Data inicial" value={filters.from} max={filters.to} onChange={(event) => DAY_KEY.test(event.target.value) && update({ from: event.target.value, to: filters.to })} className="w-auto" />
              <span className="text-sm text-muted">até</span>
              <Input type="date" aria-label="Data final" value={filters.to} min={filters.from} onChange={(event) => DAY_KEY.test(event.target.value) && update({ to: event.target.value, from: filters.from })} className="w-auto" />
            </div>
          )}
          {activeFilters && (
            <Button variant="ghost" size="sm" onClick={() => update({ tecnico: null, q: null, atrasadas: null, paradas: null, period: null, from: null, to: null, todas: null })}>
              Limpar filtros
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Atualizar quadro" onClick={resync} className={cn('text-muted', board.isFetching && 'animate-spin')}>
            <RefreshCw />
          </Button>
        </div>
      </div>

      {filters.all && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          Mostrando todas as OS entregues e canceladas.
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => update({ todas: null })}>
            Voltar aos últimos 30 dias
          </Button>
        </p>
      )}

      {board.isError ? (
        <Card className="p-6">
          <EmptyState title="Não foi possível carregar o quadro" description={errorMessage(board.error)} action={<Button onClick={resync}>Tentar de novo</Button>} />
        </Card>
      ) : !data ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-96 w-72 shrink-0" />
          ))}
        </div>
      ) : view === 'board' ? (
        <Kanban
          columns={columns}
          now={now}
          staleDays={staleDays}
          canMove={canMove}
          canDeliver={canDeliver}
          actions={actions}
          onDrop={(card, target, afterId) => requestMove(card, target, afterId)}
          onShowAll={() => update({ todas: '1' })}
        />
      ) : (
        <Card className="p-0">
          <DataTable
            columns={listColumns}
            data={listRows}
            loading={board.isFetching && listRows.length === 0}
            getRowId={(row) => row.id}
            onRowClick={(row) => openDetail(row.id)}
            empty={<EmptyState title={activeFilters ? 'Nenhuma OS com esses filtros' : 'Nenhuma OS ainda'} description={totalCards === 0 && can('os.edit') ? 'Abra a primeira pelo botão "Nova OS".' : undefined} />}
          />
        </Card>
      )}

      <OsDetailSheet
        serviceOrderId={openId ?? null}
        onClose={closeDetail}
        staff={staff}
        columns={columns}
        staleDays={staleDays}
        onDeliver={(id) => setDelivering(id)}
        onMove={(os, column) => void requestMove(os, column, undefined)}
      />

      {creating && (
        <OsFormDialog
          open
          onOpenChange={(open) => !open && setCreating(false)}
          staff={staff}
          onSaved={(detail) => {
            refresh(detail);
            setEntryPrint(detail);
          }}
        />
      )}
      {entryPrint && (
        <OsPrintDialog
          os={entryPrint}
          kind="entry"
          open
          onOpenChange={(open) => {
            if (open) return;
            setEntryPrint(null);
            openDetail(entryPrint.id);
          }}
        />
      )}

      <DeliverFlow serviceOrderId={delivering} onClose={closeDeliver} />

      <ConfirmDialog
        open={pendingCancel !== null}
        onOpenChange={(open) => {
          if (open) return;
          setPendingCancel(null);
          resync();
        }}
        title={`Cancelar a ${pendingCancel?.os.number ?? 'OS'}?`}
        description="A OS fica somente leitura. Sinais recebidos são estornados e as peças reservadas voltam ao estoque livre."
        confirmLabel="Cancelar OS"
        destructive
        onConfirm={async () => {
          if (!pendingCancel) return;
          const { os, target, afterId } = pendingCancel;
          setPendingCancel(null);
          await performMove(os, target, afterId);
        }}
      />

      <Dialog open={notice !== null} onOpenChange={(open) => !open && setNotice(null)}>
        {notice && (
          <DialogContent
            size="sm"
            title="Avisar o cliente?"
            description={`${notice.os.number} foi para "${notice.column.name}". A mensagem abre no WhatsApp para você enviar.`}
            footer={
              <>
                <Button variant="outline" onClick={() => setNotice(null)}>
                  Agora não
                </Button>
                <Button variant="primary" onClick={sendNotice}>
                  <MessageCircle /> Abrir WhatsApp
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                Para <span className="font-medium">{notice.os.customer.name}</span>
              </p>
              <p className="rounded-lg border border-border bg-surface-2 p-3 text-sm whitespace-pre-wrap">{notice.message}</p>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function ToggleChip({ active, onClick, children }: { active: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        active ? 'border-primary/40 bg-primary/10 text-primary-text' : 'border-border bg-surface text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  );
}
