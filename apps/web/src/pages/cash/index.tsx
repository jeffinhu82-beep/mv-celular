import { formatDateTime, formatMoney, formatTime, PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@loja/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownCircle, ArrowUpCircle, FileText, Lock, Receipt, RotateCcw, Unlock, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button.tsx';
import { columnHelper, DataTable, Pagination } from '@/components/ui/data-table.tsx';
import { ConfirmDialog } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Textarea } from '@/components/ui/input.tsx';
import { MoneyInput } from '@/components/ui/masked.tsx';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton, Stat, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc.tsx';
import { CloseCashDialog } from '@/features/cash/close-dialog.tsx';
import { MovementDialog, type MovementKind } from '@/features/cash/movement-dialog.tsx';
import { invalidateMoney, useCurrentCash } from '@/features/cash/queries.ts';
import { DifferenceValue } from '@/features/cash/difference-value.tsx';
import { CashReportDialog } from '@/features/cash/report-dialog.tsx';
import { movementLabel, refLink, signedAmount } from '@/features/cash/shared.ts';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';
import { useToast } from '@/lib/toast.tsx';
import type { CashMovementView, CashSessionRow, CashSessionView, Paged } from '@/lib/types.ts';
import { cn, plural, toQuery } from '@/lib/utils.ts';

const movementCol = columnHelper<CashMovementView>();
const sessionCol = columnHelper<CashSessionRow>();

function OpenCashCard({ lastCounted }: { lastCounted: number | null }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [opening, setOpening] = useState(0);
  const [saving, setSaving] = useState(false);

  if (!can('cash.open_close')) {
    return (
      <Card>
        <EmptyState icon={Lock} title="O caixa está fechado" description="Vendas e recebimentos ficam bloqueados até alguém com permissão abrir o caixa do dia." />
      </Card>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/cash/open', { openingCents: opening });
      await invalidateMoney(queryClient);
      toast.success('Caixa aberto', `Abertura de ${formatMoney(opening)}.`);
    } catch (error) {
      toast.error('Não foi possível abrir o caixa', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mx-auto max-w-md">
      <form onSubmit={submit} className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-surface-2 text-muted">
            <Lock className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold">Caixa fechado</h2>
            <p className="text-sm text-muted">Conte o troco da gaveta e abra o caixa para começar a vender.</p>
          </div>
        </div>
        <Field
          label="Valor de abertura (troco na gaveta)"
          hint={
            lastCounted !== null ? (
              <>
                No último fechamento foram contados {formatMoney(lastCounted)}.{' '}
                <button type="button" className="text-primary-text underline-offset-2 hover:underline" onClick={() => setOpening(lastCounted)}>
                  Usar este valor
                </button>
              </>
            ) : undefined
          }
        >
          <MoneyInput value={opening} onValueChange={setOpening} autoFocus />
        </Field>
        <Button variant="primary" type="submit" loading={saving}>
          <Unlock /> Abrir caixa
        </Button>
      </form>
    </Card>
  );
}

function CurrentCash({ session }: { session: CashSessionView }) {
  const { can, canAny } = useAuth();
  const [movement, setMovement] = useState<MovementKind | null>(null);
  const [closing, setClosing] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const showFees = can('finance.view');
  const canMove = canAny(['cash.open_close', 'cash.withdrawal_expense']);

  const movements = useMemo(() => [...session.movements].reverse(), [session.movements]);
  const receivedCents = session.movements.filter((entry) => entry.type === 'payment').reduce((total, entry) => total + entry.amountCents, 0);

  const columns = useMemo(
    () => [
      movementCol.accessor('occurredAt', { header: 'Hora', cell: (info) => <span className="num text-muted">{formatTime(info.getValue())}</span> }),
      movementCol.display({
        id: 'type',
        header: 'Tipo',
        meta: { className: 'hidden md:table-cell' },
        cell: ({ row }) => {
          const entry = row.original;
          const tone = entry.type === 'payment' || entry.type === 'income' ? 'success' : entry.type === 'supply' ? 'info' : entry.type === 'reversal' ? 'warning' : 'neutral';
          return <Badge tone={tone}>{movementLabel(entry)}</Badge>;
        },
      }),
      movementCol.display({
        id: 'description',
        header: 'Descrição',
        cell: ({ row }) => {
          const entry = row.original;
          const link = refLink(entry);
          return (
            <div className="min-w-0">
              <p className="md:truncate">
                <RefDescription link={link} refNumber={entry.refNumber} description={entry.description} />
              </p>
              <p className="text-xs text-muted md:hidden">{[movementLabel(entry), PAYMENT_METHOD_LABELS[entry.method]].join(', ')}</p>
              {(entry.categoryName || (entry.type === 'expense' && !entry.fromDrawer)) && (
                <p className="text-xs text-muted">
                  {entry.categoryName}
                  {entry.categoryName && entry.type === 'expense' && !entry.fromDrawer ? ', ' : ''}
                  {entry.type === 'expense' && !entry.fromDrawer ? 'fora da gaveta' : ''}
                </p>
              )}
            </div>
          );
        },
      }),
      movementCol.accessor('method', { header: 'Forma', meta: { className: 'hidden md:table-cell' }, cell: (info) => PAYMENT_METHOD_LABELS[info.getValue()] }),
      movementCol.display({
        id: 'amount',
        header: 'Valor',
        meta: { align: 'right' },
        cell: ({ row }) => {
          const value = signedAmount(row.original);
          return (
            <div className="text-right">
              <span className={cn('num font-medium', value < 0 && 'text-warning')}>{formatMoney(value)}</span>
              {showFees && (row.original.feeCents ?? 0) > 0 && <p className="num text-xs text-muted">taxa {formatMoney(row.original.feeCents)}</p>}
            </div>
          );
        },
      }),
      movementCol.display({
        id: 'user',
        header: 'Usuário',
        meta: { className: 'hidden lg:table-cell' },
        cell: ({ row }) => (
          <div>
            <p>{row.original.userName}</p>
            {row.original.approvedByName && <p className="text-xs text-muted">autorizado por {row.original.approvedByName}</p>}
          </div>
        ),
      }),
    ],
    [showFees],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Aberto por <span className="font-medium text-text">{session.openedByName}</span> em {formatDateTime(session.openedAt)} · abertura {formatMoney(session.openingCents)}
          {session.reopenedAt && <> · reaberto por {session.reopenedByName} ({session.reopenReason})</>}
        </p>
        <div className="flex flex-wrap gap-2">
          {can('cash.income') && (
            <Button onClick={() => setMovement('entry')}>
              <ArrowDownCircle /> Entrada
            </Button>
          )}
          {canMove && (
            <>
              <Button onClick={() => setMovement('withdrawal')}>
                <ArrowUpCircle /> Sangria
              </Button>
              <Button onClick={() => setMovement('expense')}>
                <Receipt /> Registrar custo
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={() => setReportId(session.id)}>
            <FileText /> Relatório parcial
          </Button>
          {can('cash.open_close') && (
            <Button variant="primary" onClick={() => setClosing(true)}>
              <Lock /> Fechar caixa
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Dinheiro esperado na gaveta" value={formatMoney(session.expectedNow.cash)} />
        {PAYMENT_METHODS.filter((method) => method !== 'cash').map((method) => (
          <Stat key={method} label={PAYMENT_METHOD_LABELS[method]} value={formatMoney(session.expectedNow[method])} />
        ))}
        <Stat label="Recebido em vendas e OS" value={formatMoney(receivedCents)} />
      </div>

      <Card>
        <CardHeader title="Extrato do caixa" description={`${plural(session.movements.length, 'movimentação', 'movimentações')}, da mais recente para a mais antiga.`} />
        <DataTable
          columns={columns}
          data={movements}
          getRowId={(row) => row.id}
          empty={
            <EmptyState
              icon={Wallet}
              title="Nenhuma movimentação ainda"
              description="Vendas, recebimentos de OS, entradas, sangrias e custos aparecem aqui assim que forem registrados."
            />
          }
        />
      </Card>

      <MovementDialog kind={movement} onOpenChange={(open) => !open && setMovement(null)} />
      <CloseCashDialog session={session} open={closing} onOpenChange={setClosing} onClosed={setReportId} />
      <CashReportDialog sessionId={reportId} onOpenChange={(open) => !open && setReportId(null)} />
    </div>
  );
}

function ReopenAction({ sessionId, onDone }: { sessionId: string; onDone(): void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    if (!reason.trim()) {
      setError('Informe o motivo da reabertura.');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/api/cash/sessions/${sessionId}/reopen`, { reason: reason.trim() });
      await invalidateMoney(queryClient);
      toast.success('Caixa reaberto', 'Lance o que faltou e feche de novo.');
      setOpen(false);
      onDone();
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'APPROVAL_CANCELLED') return;
      toast.error('Não foi possível reabrir', errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        variant="danger"
        onClick={() => {
          setReason('');
          setError(undefined);
          setOpen(true);
        }}
      >
        <RotateCcw /> Reabrir caixa
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Reabrir este caixa?"
        description="O fechamento é desfeito e o caixa volta a aceitar lançamentos. Fica registrado no log com o seu nome e o motivo."
        confirmLabel="Reabrir"
        destructive
        loading={saving}
        onConfirm={confirm}
      >
        <Field label="Motivo" required error={error}>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={300} autoFocus />
        </Field>
      </ConfirmDialog>
    </>
  );
}

function CashHistory({ hasOpenSession }: { hasOpenSession: boolean }) {
  const { canAny } = useAuth();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const sessions = useQuery({
    queryKey: ['cash', 'sessions', page],
    queryFn: () => api.get<Paged<CashSessionRow>>(`/api/cash/sessions${toQuery({ page })}`),
    placeholderData: keepPreviousData,
  });
  const latestId = page === 1 ? sessions.data?.items[0]?.id : undefined;
  const selectedRow = sessions.data?.items.find((row) => row.id === selected);
  const canReopen = canAny(['cash.reopen', 'cash.open_close']) && !hasOpenSession && selectedRow?.status === 'closed' && selected === latestId;

  const columns = useMemo(
    () => [
      sessionCol.accessor('openedAt', {
        header: 'Abertura',
        cell: ({ row }) => (
          <div>
            <p className="num">{formatDateTime(row.original.openedAt)}</p>
            <p className="text-xs text-muted">{row.original.openedByName}</p>
            {row.original.status === 'open' && (
              <Badge tone="success" className="mt-1 sm:hidden">
                Aberto
              </Badge>
            )}
          </div>
        ),
      }),
      sessionCol.accessor('closedAt', {
        header: 'Fechamento',
        meta: { className: 'hidden sm:table-cell' },
        cell: ({ row }) =>
          row.original.status === 'open' ? (
            <Badge tone="success">Aberto</Badge>
          ) : (
            <div>
              <p className="num">{formatDateTime(row.original.closedAt)}</p>
              <p className="text-xs text-muted">{row.original.closedByName}</p>
            </div>
          ),
      }),
      sessionCol.accessor('openingCents', { header: 'Abertura (R$)', meta: { align: 'right', className: 'hidden lg:table-cell' }, cell: (info) => <span className="num">{formatMoney(info.getValue())}</span> }),
      sessionCol.accessor('expectedCashCents', {
        header: 'Esperado',
        meta: { align: 'right', className: 'hidden md:table-cell' },
        cell: (info) => <span className="num">{info.getValue() === null ? '—' : formatMoney(info.getValue())}</span>,
      }),
      sessionCol.accessor('countedCashCents', {
        header: 'Contado',
        meta: { align: 'right', className: 'hidden md:table-cell' },
        cell: (info) => <span className="num">{info.getValue() === null ? '—' : formatMoney(info.getValue())}</span>,
      }),
      sessionCol.accessor('differenceCents', {
        header: 'Diferença',
        meta: { align: 'right' },
        cell: ({ row }) => (
          <div className="text-right">
            <DifferenceValue cents={row.original.differenceCents} />
            {row.original.notes && (
              <p className="ml-auto max-w-36 truncate text-xs text-muted sm:max-w-56" title={row.original.notes}>
                {row.original.notes}
              </p>
            )}
          </div>
        ),
      }),
    ],
    [],
  );

  return (
    <Card>
      <DataTable
        columns={columns}
        data={sessions.data?.items ?? []}
        loading={sessions.isPending}
        getRowId={(row) => row.id}
        onRowClick={(row) => setSelected(row.id)}
        empty={<EmptyState icon={Wallet} title="Nenhum caixa registrado ainda" description="Abra o primeiro caixa na aba Caixa atual." />}
      />
      {sessions.data && <Pagination page={page} pageSize={30} total={sessions.data.total} onPageChange={setPage} />}
      <CashReportDialog
        sessionId={selected}
        onOpenChange={(open) => !open && setSelected(null)}
        actions={canReopen && selected ? <ReopenAction sessionId={selected} onDone={() => setSelected(null)} /> : undefined}
      />
    </Card>
  );
}

export function CashPage() {
  const current = useCurrentCash();
  const lastSessions = useQuery({
    queryKey: ['cash', 'sessions', 1],
    queryFn: () => api.get<Paged<CashSessionRow>>(`/api/cash/sessions${toQuery({ page: 1 })}`),
  });
  const session = current.data?.session ?? null;
  const lastClosed = lastSessions.data?.items.find((row) => row.status === 'closed');

  return (
    <>
      <PageHeader title="Caixa" description="Abertura, lançamentos do dia e fechamento com conferência." />
      <Tabs defaultValue="current">
        <TabsList>
          <TabsTrigger value="current">Caixa atual</TabsTrigger>
          <TabsTrigger value="history">Histórico de caixas</TabsTrigger>
        </TabsList>
        <TabsContent value="current" className="mt-4">
          {current.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : session ? (
            <CurrentCash session={session} />
          ) : (
            <OpenCashCard lastCounted={lastClosed?.countedCashCents ?? null} />
          )}
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <CashHistory hasOpenSession={Boolean(session)} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function RefDescription({ link, refNumber, description }: { link: string | null; refNumber: string | null; description: string | null }) {
  if (!link || !refNumber) return <>{description}</>;
  const anchor = (
    <Link to={link} className="font-medium text-primary-text hover:underline">
      {refNumber}
    </Link>
  );
  if (description?.includes(refNumber)) {
    const at = description.indexOf(refNumber);
    return (
      <>
        {description.slice(0, at)}
        {anchor}
        {description.slice(at + refNumber.length)}
      </>
    );
  }
  return (
    <>
      {anchor}
      {description ? ` · ${description}` : ''}
    </>
  );
}
