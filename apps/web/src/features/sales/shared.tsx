import {
  DEFAULT_TEMPLATES,
  firstName,
  formatDate,
  formatMoney,
  PAYMENT_METHOD_LABELS,
  renderTemplate,
  SALE_STATUS_LABELS,
  whatsappLink,
  type PaymentMethod,
  type SaleStatus,
} from '@loja/shared';
import { Badge } from '@/components/ui/misc.tsx';
import type { SaleDetail, StoreSettings } from '@/lib/types.ts';

const STATUS_TONES = { quote: 'info', completed: 'success', pending: 'warning', cancelled: 'muted' } as const;

export function SaleStatusBadge({ status, expired }: { status: SaleStatus; expired?: boolean }) {
  if (status === 'quote' && expired) return <Badge tone="muted">Vencido</Badge>;
  return <Badge tone={STATUS_TONES[status]}>{SALE_STATUS_LABELS[status]}</Badge>;
}

export function methodLabel(method: PaymentMethod, installments = 1): string {
  return method === 'credit' ? `${PAYMENT_METHOD_LABELS.credit} ${installments}x` : PAYMENT_METHOD_LABELS[method];
}

export function saleCode(sale: Pick<SaleDetail, 'number' | 'quoteNumber'>): string {
  return sale.number ?? sale.quoteNumber ?? '—';
}

function itemsText(sale: SaleDetail): string {
  return `${sale.items.map((item) => `${item.qty}x ${item.name} (${formatMoney(item.totalCents)})`).join('; ')}.`;
}

export function saleMessage(sale: SaleDetail, settings: StoreSettings | undefined): string {
  const quote = sale.status === 'quote';
  return renderTemplate(quote ? DEFAULT_TEMPLATES.saleQuote : DEFAULT_TEMPLATES.saleReceipt, {
    primeiro_nome: firstName(sale.customer?.name) || 'tudo bem',
    cliente: sale.customer?.name,
    loja: settings?.name ?? '',
    numero: saleCode(sale),
    itens: itemsText(sale),
    total: formatMoney(sale.totalCents),
    validade: formatDate(sale.quoteValidUntil),
  })
    .replace(/\s+/g, ' ')
    .trim();
}

export function saleWhatsappLink(sale: SaleDetail, settings: StoreSettings | undefined): string | null {
  return whatsappLink(sale.customer?.phoneE164, saleMessage(sale, settings));
}

export const SALE_LOG_LABELS: Record<string, string> = {
  'sale.completed': 'Venda concluída',
  'quote.created': 'Orçamento criado',
  'quote.converted': 'Orçamento convertido em venda',
  'quote.cancelled': 'Orçamento cancelado',
  'sale.discount_over_limit': 'Desconto acima do limite autorizado',
  'sale.price_override': 'Preço alterado com autorização',
  'sale.cancelled': 'Venda cancelada',
  'sale.payment_received': 'Saldo recebido',
};
