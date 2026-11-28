import {
  APPROVAL_CHANNEL_LABELS,
  formatMoney,
  formatPhoneBR,
  renderTemplate,
  serviceOrderTemplateValues,
  whatsappLink,
  zonedDateToUtc,
  zonedParts,
  type ApprovalChannel,
  type OsTemplateInput,
} from '@loja/shared';
import { AlarmClock, Hourglass, PackageX, ShieldCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/misc.tsx';
import { api } from '@/lib/api.ts';
import type { OsFlags, StoreSettings } from '@/lib/types.ts';
import { cn } from '@/lib/utils.ts';

export const OS_EVENT_LABELS: Record<string, string> = {
  created: 'OS aberta',
  moved: 'Mudou de coluna',
  edited: 'Dados editados',
  whatsapp_opened: 'WhatsApp aberto',
  payment: 'Pagamento recebido',
  approved: 'Orçamento aprovado',
  rejected: 'Orçamento recusado',
  quote_updated: 'Orçamento atualizado',
  delivered: 'Entregue ao cliente',
  secret_viewed: 'Senha de desbloqueio vista',
  printed: 'Impressão',
};

export const OS_PRINT_LABELS = { entry: 'Comprovante de entrada', quote: 'Orçamento', delivery: 'Comprovante de entrega' } as const;

export const EDITED_FIELD_LABELS: Record<string, string> = {
  customerId: 'cliente',
  deviceType: 'tipo do aparelho',
  brand: 'marca',
  model: 'modelo',
  color: 'cor',
  serialImei: 'IMEI/série',
  unlockType: 'tipo de desbloqueio',
  unlockSecret: 'senha',
  accessories: 'acessórios',
  checklist: 'checklist',
  reportedIssue: 'defeito relatado',
  diagnosis: 'diagnóstico',
  dueAt: 'previsão',
  technicianId: 'técnico',
  warrantyDays: 'garantia',
};

export function channelLabel(channel: string | null | undefined): string {
  return channel ? (APPROVAL_CHANNEL_LABELS[channel as ApprovalChannel] ?? channel) : '—';
}

export function deviceLabel(os: { brand: string; model: string }): string {
  return `${os.brand} ${os.model}`.trim();
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ''}${parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''}`.toUpperCase();
}

export function TechAvatar({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <span
      title={name ? `Técnico: ${name}` : 'Sem técnico'}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
        name ? 'bg-surface-3 text-text' : 'border border-dashed border-border text-muted',
        className,
      )}
    >
      {name ? initials(name) : '—'}
      <span className="sr-only">{name ? `Técnico ${name}` : 'Sem técnico'}</span>
    </span>
  );
}

export function FlagBadges({ flags, staleDays }: { flags: OsFlags; staleDays?: number }) {
  return (
    <>
      {flags.late && (
        <Badge tone="primary">
          <AlarmClock className="size-3" aria-hidden /> Atrasada
        </Badge>
      )}
      {flags.stale && (
        <Badge tone="warning">
          <Hourglass className="size-3" aria-hidden /> Parada{staleDays ? ` +${staleDays}d` : ''}
        </Badge>
      )}
      {flags.waitingPart && (
        <Badge tone="info">
          <PackageX className="size-3" aria-hidden /> Aguardando peça
        </Badge>
      )}
      {flags.warranty && (
        <Badge tone="success">
          <ShieldCheck className="size-3" aria-hidden /> Garantia
        </Badge>
      )}
    </>
  );
}

export function BalanceBadge({ totalCents, balanceCents, paidCents }: { totalCents: number; balanceCents: number; paidCents: number }) {
  if (totalCents <= 0) return null;
  if (balanceCents <= 0) return <Badge tone="success">Pago</Badge>;
  return <Badge tone={paidCents > 0 ? 'warning' : 'neutral'}>Saldo {formatMoney(balanceCents)}</Badge>;
}

export interface OsMessageSource extends Omit<OsTemplateInput, 'customerName'> {
  customer: { name: string; phoneE164: string };
}

export function osMessage(templateBody: string, os: OsMessageSource, settings: StoreSettings | undefined): string {
  const values = serviceOrderTemplateValues(
    { ...os, customerName: os.customer.name },
    { name: settings?.name ?? '', phone: settings?.whatsapp ? formatPhoneBR(settings.whatsapp) : null, address: settings?.address ?? null },
  );
  return renderTemplate(templateBody, values).replace(/[ \t]+/g, ' ').trim();
}

export const GENERIC_OS_TEMPLATE = 'Olá, {primeiro_nome}! Aqui é da {loja}, sobre a sua OS {numero_os} ({aparelho}).';

export function useOsWhatsapp() {
  const queryClient = useQueryClient();
  return (serviceOrderId: string, phoneE164: string, message: string, context: string): boolean => {
    const link = whatsappLink(phoneE164, message);
    if (!link) return false;
    window.open(link, '_blank', 'noopener');
    void api
      .post(`/api/service-orders/${serviceOrderId}/whatsapp`, { context })
      .then(() => queryClient.invalidateQueries({ queryKey: ['service-order', serviceOrderId] }))
      .catch(() => undefined);
    return true;
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const parts = zonedParts(new Date(iso));
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function fromLocalInput(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number) as [number, number, number, number, number, number];
  return zonedDateToUtc(year, month, day, undefined, hour, minute).toISOString();
}
