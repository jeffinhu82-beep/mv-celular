import { formatDate, formatDateTime, formatMoney, formatPhoneBR, OS_ITEM_KIND_LABELS, SALE_STATUS_LABELS, UNLOCK_TYPE_LABELS, type PaymentMethod } from '@loja/shared';
import {
  ArrowRightLeft,
  ClipboardList,
  Eye,
  EyeOff,
  FileText,
  HandCoins,
  MessageCircle,
  Pencil,
  Printer,
  Receipt,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  Wallet,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useStoreSettings } from '@/components/layout/app-shell.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Sheet } from '@/components/ui/dialog.tsx';
import { Badge, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Skeleton } from '@/components/ui/misc.tsx';
import { useCashStatus } from '@/features/cash/queries.ts';
import { StageDot } from '@/features/dashboard/shared.tsx';
import { methodLabel } from '@/features/sales/shared.tsx';
import { api, errorMessage } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';
import { useToast } from '@/lib/toast.tsx';
import type { BoardColumn, OsEventView, ServiceOrderDetail } from '@/lib/types.ts';
import { cn } from '@/lib/utils.ts';
import { checklistEntries, OsPrintDialog, type OsPrintKind } from './documents.tsx';
import { ApprovalDialog, DepositDialog } from './os-actions.tsx';
import { OsFormDialog, PatternInput } from './os-form.tsx';
import { useRefreshServiceOrders, useServiceOrder } from './queries.ts';
import { QuoteEditorDialog } from './quote-editor.tsx';
import { channelLabel, deviceLabel, EDITED_FIELD_LABELS, FlagBadges, GENERIC_OS_TEMPLATE, OS_EVENT_LABELS, OS_PRINT_LABELS, osMessage, TechAvatar, useOsWhatsapp } from './shared.tsx';

type Dialogs = 'edit' | 'quote' | 'approval' | 'deposit' | null;

export function OsDetailSheet({
  serviceOrderId,
  onClose,
  staff,
  columns,
  staleDays,
  onDeliver,
  onMove,
}: {
  serviceOrderId: string | null;
  onClose(): void;
  staff: { id: string; name: string }[];
  columns: BoardColumn[];
  staleDays: number;
  onDeliver(id: string): void;
  onMove(os: ServiceOrderDetail, column: BoardColumn): void;
}) {
  const detail = useServiceOrder(serviceOrderId);
  const os = detail.data;
  return (
    <Sheet
      open={Boolean(serviceOrderId)}
      onOpenChange={(open) => !open && onClose()}
      width="max-w-2xl"
      title={os ? <span className="num">{os.number}</span> : 'Ordem de serviço'}
      description={os ? `Aberta em ${formatDateTime(os.createdAt)}${os.createdByName ? ` por ${os.createdByName}` : ''}` : undefined}
    >
      {detail.isError ? (
        <p className="text-sm text-muted">{errorMessage(detail.error)}</p>
      ) : !os ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <DetailBody os={os} staff={staff} columns={columns} staleDays={staleDays} onDeliver={onDeliver} onMove={onMove} />
      )}
    </Sheet>
  );
}

function DetailBody({
  os,
  staff,
  columns,
  staleDays,
  onDeliver,
  onMove,
}: {
  os: ServiceOrderDetail;
  staff: { id: string; name: string }[];
  columns: BoardColumn[];
  staleDays: number;
  onDeliver(id: string): void;
  onMove(os: ServiceOrderDetail, column: BoardColumn): void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const settings = useStoreSettings();
  const cash = useCashStatus();
  const refresh = useRefreshServiceOrders();
  const openWhatsapp = useOsWhatsapp();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [print, setPrint] = useState<OsPrintKind | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  useEffect(() => setSecret(null), [os.id]);

  const editable = os.open;
  const ready = os.open && os.column.stageType === 'ready';
  const cashOpen = Boolean(cash.data?.session);
  const canMove = can('os.move') && editable;
  const canDeliver = can('sale.create') && ready;
  const canDeposit = can('sale.create') && editable && os.totalCents > 0 && os.balanceCents > 0 && !ready;
  const canQuote = can('os.quote_edit') && editable;
  const canApprove = (can('os.edit') || can('os.quote_edit')) && editable;
  const targets = columns.filter((column) => column.id !== os.columnId && column.stageType !== 'done');

  const saved = (next: ServiceOrderDetail) => refresh(next);

  const whatsapp = () => {
    const template = os.column.whatsappEnabled && os.column.template ? os.column.template.body : GENERIC_OS_TEMPLATE;
    if (!openWhatsapp(os.id, os.customer.phoneE164, osMessage(template, os, settings.data), 'manual')) toast.error('Cliente sem WhatsApp válido');
  };

  const reveal = async () => {
    setRevealing(true);
    try {
      const result = await api.post<{ unlockType: string; secret: string }>(`/api/service-orders/${os.id}/secret`, {});
      setSecret(result.secret);
      refresh();
    } catch (error) {
      toast.error('Não foi possível mostrar a senha', errorMessage(error));
    } finally {
      setRevealing(false);
    }
  };

  const depositNeedsCash = () => {
    if (cashOpen) return true;
    toast.error('Caixa fechado', 'Abra o caixa para receber o sinal.');
    return false;
  };

  return (
    <div className="flex flex-col gap-6 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral" className="gap-1.5">
          <StageDot color={os.column.color} /> {os.column.name}
        </Badge>
        <FlagBadges flags={os.flags} staleDays={staleDays} />
        {os.sale && (
          <Link to={`/vendas/${os.sale.id}`} className="text-xs text-info underline-offset-2 hover:underline">
            Venda {os.sale.number ?? ''} · {SALE_STATUS_LABELS[os.sale.status]}
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {canDeliver && (
          <Button variant="primary" size="sm" onClick={() => onDeliver(os.id)}>
            <HandCoins /> Receber e entregar
          </Button>
        )}
        {can('os.edit') && editable && (
          <Button variant="outline" size="sm" onClick={() => setDialog('edit')}>
            <Pencil /> Editar
          </Button>
        )}
        {canMove && targets.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <ArrowRightLeft /> Mover para…
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              {targets.map((target) => (
                <DropdownMenuItem key={target.id} onSelect={() => onMove(os, target)}>
                  <StageDot color={target.color} /> {target.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Printer /> Imprimir
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-60">
            <DropdownMenuItem onSelect={() => setPrint('entry')}>
              <ClipboardList /> {OS_PRINT_LABELS.entry}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPrint('quote')} disabled={os.items.length === 0}>
              <FileText /> {OS_PRINT_LABELS.quote}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPrint('delivery')} disabled={!os.deliveredAt}>
              <Receipt /> {OS_PRINT_LABELS.delivery}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Section title="Cliente">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Link to={`/clientes/${os.customer.id}`} className="font-medium underline-offset-2 hover:underline">
              {os.customer.name}
            </Link>
            <p className="num text-sm text-muted">{os.customer.phoneE164 ? formatPhoneBR(os.customer.phoneE164) : 'Sem telefone'}</p>
          </div>
          {os.customer.phoneE164 && !os.customer.anonymizedAt && (
            <Button variant="outline" size="sm" className="text-success" onClick={whatsapp}>
              <MessageCircle /> WhatsApp
            </Button>
          )}
        </div>
      </Section>

      <Section title="Aparelho">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Info label="Aparelho" value={`${os.deviceType} · ${deviceLabel(os)}`} />
          <Info label="Cor" value={os.color} />
          <Info label="IMEI / série" value={os.serialImei} mono />
          <Info label="Acessórios" value={os.accessories} />
        </dl>
        <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <span className="text-muted">Desbloqueio: </span>
              <span className="font-medium">{UNLOCK_TYPE_LABELS[os.unlockType]}</span>
              {os.unlockType !== 'none' && !os.hasSecret && <span className="text-muted"> · não informado</span>}
            </div>
            {os.hasSecret && can('os.unlock_secret.view') && (
              <Button size="sm" variant="ghost" onClick={() => (secret === null ? void reveal() : setSecret(null))} disabled={revealing}>
                {secret === null ? (
                  <>
                    <Eye /> Mostrar
                  </>
                ) : (
                  <>
                    <EyeOff /> Ocultar
                  </>
                )}
              </Button>
            )}
          </div>
          {secret !== null && (
            <div className="mt-3">
              {os.unlockType === 'pattern' ? <PatternInput value={secret} /> : <p className="num text-lg font-semibold tracking-wider select-all">{secret}</p>}
              <p className="mt-2 text-xs text-muted">A visualização fica registrada na linha do tempo.</p>
            </div>
          )}
        </div>
      </Section>

      <Section title="Entrada">
        <div className="flex flex-col gap-3 text-sm">
          <div>
            <p className="text-xs text-muted">Defeito relatado</p>
            <p className="whitespace-pre-wrap">{os.reportedIssue}</p>
          </div>
          {os.diagnosis && (
            <div>
              <p className="text-xs text-muted">Diagnóstico</p>
              <p className="whitespace-pre-wrap">{os.diagnosis}</p>
            </div>
          )}
          <Checklist os={os} />
        </div>
      </Section>

      <Section title="Prazo e responsável">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Info label="Previsão" value={os.dueAt ? formatDateTime(os.dueAt) : null} warn={os.flags.late} />
          <div className="flex flex-col">
            <dt className="text-xs text-muted">Técnico</dt>
            <dd className="flex items-center gap-2">
              <TechAvatar name={os.technicianName} /> {os.technicianName ?? <span className="text-muted">Sem técnico</span>}
            </dd>
          </div>
          <Info label="Garantia" value={os.warrantyDays > 0 ? `${os.warrantyDays} dias` : 'Sem garantia'} />
          {os.deliveredAt && (
            <Info
              label="Entregue"
              value={`${formatDateTime(os.deliveredAt)}${os.warrantyUntil ? ` · garantia até ${formatDate(os.warrantyUntil)}${os.warrantyActive ? '' : ' (vencida)'}` : ''}`}
            />
          )}
        </dl>
        {(os.parentOs || os.returns.length > 0) && (
          <div className="mt-3 flex flex-col gap-1 text-sm">
            {os.parentOs && (
              <p className="flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-info" aria-hidden />
                Retorno de garantia da{' '}
                <Link to={`/os/${os.parentOs.id}`} className="num text-info underline-offset-2 hover:underline">
                  {os.parentOs.number}
                </Link>
                {os.parentOs.warrantyUntil && <span className="text-muted">· garantia até {formatDate(os.parentOs.warrantyUntil)}</span>}
              </p>
            )}
            {os.returns.map((entry) => (
              <p key={entry.id} className="text-muted">
                Retorno aberto:{' '}
                <Link to={`/os/${entry.id}`} className="num text-info underline-offset-2 hover:underline">
                  {entry.number}
                </Link>{' '}
                em {formatDate(entry.createdAt)}
              </p>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Orçamento"
        action={
          canQuote && (
            <Button size="sm" variant="outline" onClick={() => setDialog('quote')}>
              <Pencil /> {os.items.length > 0 ? 'Editar' : 'Lançar'}
            </Button>
          )
        }
      >
        <Quote os={os} />
        <Approval os={os} />
        <div className="mt-3 flex flex-wrap gap-2">
          {canApprove && os.approvalStatus === null && (
            <Button size="sm" variant="outline" onClick={() => setDialog('approval')}>
              <ThumbsUp /> Registrar resposta
            </Button>
          )}
          {os.items.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setPrint('quote')}>
              <FileText /> Imprimir ou enviar
            </Button>
          )}
        </div>
      </Section>

      <Section
        title="Pagamentos"
        action={
          canDeposit && (
            <Button size="sm" variant="outline" onClick={() => depositNeedsCash() && setDialog('deposit')}>
              <Wallet /> Registrar sinal
            </Button>
          )
        }
      >
        <Payments os={os} />
      </Section>

      <Section title="Linha do tempo">
        <Timeline events={os.events} />
      </Section>

      <OsFormDialog open={dialog === 'edit'} onOpenChange={(open) => !open && setDialog(null)} os={os} staff={staff} onSaved={saved} />
      <QuoteEditorDialog os={os} open={dialog === 'quote'} onOpenChange={(open) => !open && setDialog(null)} onSaved={saved} />
      <ApprovalDialog os={os} open={dialog === 'approval'} onOpenChange={(open) => !open && setDialog(null)} onSaved={saved} />
      <DepositDialog os={os} open={dialog === 'deposit'} onOpenChange={(open) => !open && setDialog(null)} onSaved={saved} />
      {print && <OsPrintDialog os={os} kind={print} open onOpenChange={(open) => !open && setPrint(null)} />}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-8 items-center justify-between gap-2 border-b border-border pb-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Info({ label, value, mono, warn }: { label: string; value: string | null | undefined; mono?: boolean; warn?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn('truncate', mono && 'num', warn && 'text-primary-text', !value && 'text-muted')} title={value ?? undefined}>
        {value || '—'}
      </dd>
    </div>
  );
}

function Checklist({ os }: { os: ServiceOrderDetail }) {
  const entries = checklistEntries(os.checklist);
  const notes = typeof os.checklist.observacoes === 'string' ? os.checklist.observacoes : null;
  if (entries.length === 0 && !notes) return <p className="text-xs text-muted">Checklist de entrada não preenchido.</p>;
  return (
    <div>
      <p className="mb-1 text-xs text-muted">Checklist de entrada</p>
      <ul className="flex flex-wrap gap-1.5">
        {entries.map(([item, ok]) => (
          <li key={item}>
            <Badge tone={ok ? 'success' : 'primary'}>
              {item}: {ok ? 'OK' : 'Defeito'}
            </Badge>
          </li>
        ))}
      </ul>
      {notes && <p className="mt-2 text-xs whitespace-pre-wrap text-muted">{notes}</p>}
    </div>
  );
}

function Quote({ os }: { os: ServiceOrderDetail }) {
  if (os.items.length === 0) return <p className="text-sm text-muted">Nenhum item lançado ainda.</p>;
  return (
    <div className="text-sm">
      <ul className="flex flex-col divide-y divide-border/60">
        {os.items.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-3 py-1.5">
            <div className="min-w-0">
              <p className="truncate">
                {item.qty > 1 && <span className="num text-muted">{item.qty}× </span>}
                {item.name}
              </p>
              <p className="text-xs text-muted">
                {OS_ITEM_KIND_LABELS[item.kind]}
                {item.qty > 1 && ` · ${formatMoney(item.unitPriceCents)} cada`}
                {item.shortage && <span className="text-warning"> · falta no estoque (livre: {item.availableQty ?? 0})</span>}
              </p>
            </div>
            <span className="num shrink-0">{formatMoney(item.totalCents)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-2 ml-auto flex max-w-xs flex-col gap-1 border-t border-border pt-2">
        {os.discountCents > 0 && (
          <>
            <Row label="Subtotal" value={formatMoney(os.grossCents)} />
            <Row label="Desconto" value={`−${formatMoney(os.discountCents)}`} />
          </>
        )}
        {os.diagnosisFeeCents > 0 && <Row label="Taxa de diagnóstico" value={formatMoney(os.diagnosisFeeCents)} />}
        <Row label="Total" value={formatMoney(os.totalCents)} strong />
      </dl>
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'success' | 'warning' }) {
  return (
    <div className={cn('flex justify-between gap-3', strong && 'font-semibold', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning')}>
      <dt className={cn(!strong && !tone && 'text-muted')}>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

function Approval({ os }: { os: ServiceOrderDetail }) {
  if (!os.approvalStatus) {
    if (os.items.length === 0) return null;
    return <p className="mt-2 text-xs text-muted">Aguardando resposta do cliente.</p>;
  }
  const approved = os.approvalStatus === 'approved';
  return (
    <div className={cn('mt-3 flex items-start gap-2 rounded-lg border p-2.5 text-sm', approved ? 'border-success/30 bg-success/5' : 'border-primary/30 bg-primary/5')}>
      {approved ? <ThumbsUp className="mt-0.5 size-4 text-success" aria-hidden /> : <ThumbsDown className="mt-0.5 size-4 text-primary-text" aria-hidden />}
      <div>
        <p className="font-medium">
          {approved ? 'Aprovado' : 'Recusado'} por {os.approvalBy ?? 'cliente'} · {channelLabel(os.approvalChannel)}
        </p>
        <p className="text-xs text-muted">
          {os.approvalAt && formatDateTime(os.approvalAt)}
          {os.approvalRegisteredByName && ` · registrado por ${os.approvalRegisteredByName}`}
        </p>
      </div>
    </div>
  );
}

function Payments({ os }: { os: ServiceOrderDetail }) {
  return (
    <div className="text-sm">
      {os.payments.length === 0 ? (
        <p className="text-muted">Nenhum pagamento recebido.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {os.payments.map((payment) => (
            <li key={payment.id} className={cn('flex items-start justify-between gap-3 py-1.5', payment.reversedAt && 'opacity-60')}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5">
                  {methodLabel(payment.method, payment.installments)}
                  {payment.deposit && <Badge tone="info">Sinal</Badge>}
                  {payment.reversedAt && <Badge tone="muted">Estornado</Badge>}
                </p>
                <p className="text-xs text-muted">
                  {formatDateTime(payment.receivedAt)} · {payment.receivedByName}
                </p>
              </div>
              <span className={cn('num shrink-0', payment.reversedAt && 'line-through')}>{formatMoney(payment.coveredCents)}</span>
            </li>
          ))}
        </ul>
      )}
      {os.totalCents > 0 && (
        <dl className="mt-2 ml-auto flex max-w-xs flex-col gap-1 border-t border-border pt-2">
          <Row label="Total" value={formatMoney(os.totalCents)} />
          <Row label="Pago" value={formatMoney(os.paidCents)} tone={os.paidCents > 0 ? 'success' : undefined} />
          <Row label="Saldo" value={formatMoney(os.balanceCents)} strong tone={os.balanceCents > 0 ? 'warning' : undefined} />
        </dl>
      )}
    </div>
  );
}

function eventDetail(event: OsEventView): ReactNode {
  const data = event.data ?? {};
  const money = (key: string) => (typeof data[key] === 'number' ? formatMoney(data[key] as number) : null);
  switch (event.type) {
    case 'created':
      return event.toColumn ? `Em ${event.toColumn.name}` : null;
    case 'moved':
    case 'delivered': {
      const path = event.fromColumn && event.toColumn ? `${event.fromColumn.name} → ${event.toColumn.name}` : null;
      const extra =
        event.type === 'delivered'
          ? [data.saleNumber ? `venda ${String(data.saleNumber)}` : null, money('receivedCents') ? `recebido ${money('receivedCents')}` : null, (data.pendingCents as number) > 0 ? `a receber ${money('pendingCents')}` : null]
          : [typeof data.reason === 'string' ? data.reason : null];
      return [path, ...extra].filter(Boolean).join(' · ') || null;
    }
    case 'edited': {
      const fields = Array.isArray(data.fields) ? (data.fields as string[]) : [];
      return fields.length > 0 ? `Alterou ${fields.map((field) => EDITED_FIELD_LABELS[field] ?? field).join(', ')}` : null;
    }
    case 'payment': {
      const methods = Array.isArray(data.methods)
        ? (data.methods as { method: PaymentMethod; installments?: number }[]).map((line) => methodLabel(line.method, line.installments ?? 1)).join(', ')
        : null;
      return [money('receivedCents'), methods].filter(Boolean).join(' · ') || null;
    }
    case 'approved':
    case 'rejected':
      return [typeof data.by === 'string' ? data.by : null, typeof data.channel === 'string' ? channelLabel(data.channel) : null, (data.diagnosisFeeCents as number) > 0 ? `taxa ${money('diagnosisFeeCents')}` : null]
        .filter(Boolean)
        .join(' · ');
    case 'quote_updated':
      return [typeof data.itemsCount === 'number' ? `${data.itemsCount} ${data.itemsCount === 1 ? 'item' : 'itens'}` : null, money('totalCents') ? `total ${money('totalCents')}` : null].filter(Boolean).join(' · ') || null;
    case 'printed':
      return typeof data.kind === 'string' ? (OS_PRINT_LABELS[data.kind as OsPrintKind] ?? data.kind) : null;
    case 'whatsapp_opened':
      return data.context === 'on_move' ? 'Aviso ao mudar de coluna' : data.context === 'manual' ? 'Mensagem manual' : typeof data.context === 'string' ? `Mensagem: ${data.context}` : null;
    default:
      return null;
  }
}

function Timeline({ events }: { events: OsEventView[] }) {
  const ordered = [...events].reverse();
  if (ordered.length === 0) return <p className="text-sm text-muted">Sem eventos.</p>;
  return (
    <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
      {ordered.map((event) => {
        const detail = eventDetail(event);
        return (
          <li key={event.id} className="relative text-sm">
            <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-surface" style={{ backgroundColor: event.toColumn?.color ?? 'var(--color-muted)' }} aria-hidden />
            <p className="font-medium">{OS_EVENT_LABELS[event.type] ?? event.type}</p>
            {detail && <p className="text-xs text-text/80">{detail}</p>}
            <p className="text-xs text-muted">
              {formatDateTime(event.createdAt)}
              {event.userName && ` · ${event.userName}`}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
