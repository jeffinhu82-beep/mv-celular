import {
  DEFAULT_TEMPLATES,
  formatCpf,
  formatDate,
  formatDateTime,
  formatDocument,
  formatMoney,
  formatPhoneBR,
  OS_ITEM_KIND_LABELS,
  UNLOCK_TYPE_LABELS,
  type PrintSize,
} from '@loja/shared';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Printer } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useStoreSettings } from '@/components/layout/app-shell.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { PaperPreview, PrintPortal, PrintSizePicker, PRINT_WIDTHS, printNow } from '@/features/print/print.tsx';
import { methodLabel } from '@/features/sales/shared.tsx';
import { api } from '@/lib/api.ts';
import type { ServiceOrderDetail, StoreSettings } from '@/lib/types.ts';
import { cn } from '@/lib/utils.ts';
import { channelLabel, deviceLabel, OS_PRINT_LABELS, osMessage, useOsWhatsapp } from './shared.tsx';

export type OsPrintKind = keyof typeof OS_PRINT_LABELS;

const TITLES: Record<OsPrintKind, string> = {
  entry: 'ORDEM DE SERVIÇO · ENTRADA',
  quote: 'ORÇAMENTO DE SERVIÇO',
  delivery: 'COMPROVANTE DE ENTREGA',
};

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-2', strong && 'font-bold')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Block({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="border-b border-dashed border-black py-2">
      {title && <p className="mb-0.5 font-bold uppercase">{title}</p>}
      {children}
    </div>
  );
}

export function checklistEntries(checklist: Record<string, boolean | string>) {
  return Object.entries(checklist).filter(([, value]) => typeof value === 'boolean') as [string, boolean][];
}

export function isDepositPayment(os: Pick<ServiceOrderDetail, 'deliveredAt'>, payment: { deposit: boolean; receivedAt: string }) {
  return payment.deposit || (Boolean(os.deliveredAt) && payment.receivedAt < os.deliveredAt!);
}

export function OsDocument({ os, kind, settings, size }: { os: ServiceOrderDetail; kind: OsPrintKind; settings: StoreSettings | undefined; size: PrintSize }) {
  const narrow = size !== 'A4';
  const payments = os.payments.filter((payment) => !payment.reversedAt);
  const checklist = checklistEntries(os.checklist);
  const notes = typeof os.checklist.observacoes === 'string' ? os.checklist.observacoes : '';
  const terms = kind === 'entry' ? settings?.entryTerms : kind === 'delivery' ? settings?.warrantyTerms : null;
  const showItems = kind !== 'entry' && os.items.length > 0;

  return (
    <div className={cn('font-sans text-black', narrow ? 'text-[11px] leading-snug' : 'text-[13px] leading-normal', PRINT_WIDTHS[size])}>
      <div className={cn('border-b border-dashed border-black pb-2', narrow ? 'text-center' : 'flex items-start justify-between gap-4')}>
        <div className={cn(narrow && 'flex flex-col items-center')}>
          {settings?.logoUrl && <img src={settings.logoUrl} alt="" className={cn('mb-1 object-contain', narrow ? 'h-10' : 'h-14')} />}
          <p className="text-[1.15em] font-bold">{settings?.name}</p>
          {settings?.document && <p>CNPJ/CPF {formatDocument(settings.document)}</p>}
          {settings?.address && <p>{settings.address}</p>}
          {settings?.whatsapp && <p>WhatsApp {formatPhoneBR(settings.whatsapp)}</p>}
        </div>
        <div className={cn(narrow ? 'mt-2' : 'text-right')}>
          <p className="font-bold">{TITLES[kind]}</p>
          <p className="text-[1.1em] font-bold">{os.number}</p>
          <p>{kind === 'delivery' ? formatDateTime(os.deliveredAt ?? os.closedAt) : kind === 'entry' ? formatDateTime(os.createdAt) : formatDateTime(new Date().toISOString())}</p>
          {kind === 'entry' && <p>Via do cliente</p>}
        </div>
      </div>

      <Block>
        <p>Cliente: {os.customer.name}</p>
        {os.customer.cpf && <p>CPF: {formatCpf(os.customer.cpf)}</p>}
        <p>Telefone: {formatPhoneBR(os.customer.phoneE164)}</p>
        {os.createdByName && kind === 'entry' && <p>Atendente: {os.createdByName}</p>}
        {os.technicianName && kind !== 'entry' && <p>Técnico: {os.technicianName}</p>}
      </Block>

      <Block title="Aparelho">
        <p>
          {os.deviceType} · {deviceLabel(os)}
          {os.color ? ` · ${os.color}` : ''}
        </p>
        {os.serialImei && <p>IMEI/série: {os.serialImei}</p>}
        {kind === 'entry' && <p>Desbloqueio: {os.unlockType === 'none' ? 'sem senha' : `${UNLOCK_TYPE_LABELS[os.unlockType]} informado (não impresso)`}</p>}
        {kind === 'entry' && <p>Acessórios: {os.accessories || 'nenhum'}</p>}
      </Block>

      {kind === 'entry' && checklist.length > 0 && (
        <Block title="Checklist de entrada">
          <ul className={cn(narrow ? '' : 'grid grid-cols-2 gap-x-6')}>
            {checklist.map(([item, ok]) => (
              <li key={item} className="flex justify-between gap-2">
                <span>{item}</span>
                <span>{ok ? 'OK' : 'Com defeito'}</span>
              </li>
            ))}
          </ul>
          {notes && <p className="mt-1">Obs.: {notes}</p>}
        </Block>
      )}

      <Block title="Defeito relatado">
        <p className="whitespace-pre-line">{os.reportedIssue}</p>
        {kind !== 'entry' && os.diagnosis && (
          <>
            <p className="mt-1 font-bold uppercase">Diagnóstico</p>
            <p className="whitespace-pre-line">{os.diagnosis}</p>
          </>
        )}
        {kind === 'entry' && <p className="mt-1">Previsão: {os.dueAt ? formatDateTime(os.dueAt) : 'a combinar'}</p>}
      </Block>

      {showItems && (
        <table className="my-2 w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-0.5 font-semibold">Item</th>
              <th className="py-0.5 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {os.items.map((item) => (
              <tr key={item.id} className="align-top">
                <td className="py-0.5 pr-2">
                  {item.name}
                  <span className="block opacity-80">
                    {OS_ITEM_KIND_LABELS[item.kind]} · {item.qty} x {formatMoney(item.unitPriceCents)}
                  </span>
                </td>
                <td className="py-0.5 text-right tabular-nums">{formatMoney(item.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {kind !== 'entry' && (
        <div className="border-b border-dashed border-black py-2">
          {os.discountCents > 0 && (
            <>
              <Row label="Subtotal" value={formatMoney(os.grossCents)} />
              <Row label="Desconto" value={`−${formatMoney(os.discountCents)}`} />
            </>
          )}
          <Row label="TOTAL" value={formatMoney(os.totalCents)} strong />
          {kind === 'quote' && os.depositCents > 0 && <Row label="Sinal pago" value={formatMoney(os.depositCents)} />}
          {kind === 'quote' && os.approvalStatus && (
            <p className="mt-1">
              {os.approvalStatus === 'approved' ? 'Aprovado' : 'Recusado'} por {os.approvalBy} em {formatDateTime(os.approvalAt)} ({channelLabel(os.approvalChannel)})
            </p>
          )}
        </div>
      )}

      {kind === 'delivery' && (
        <Block title="Pagamentos">
          {payments.length === 0 && <p>Nenhum pagamento.</p>}
          {payments.map((payment) => (
            <Row
              key={payment.id}
              label={`${isDepositPayment(os, payment) ? 'Sinal · ' : ''}${methodLabel(payment.method, payment.installments)}`}
              value={formatMoney(payment.coveredCents + payment.surchargeCents)}
            />
          ))}
          {os.balanceCents > 0 && <Row label="Saldo a pagar" value={formatMoney(os.balanceCents)} strong />}
          {os.sale && <p className="mt-1">Venda {os.sale.number}</p>}
        </Block>
      )}

      {kind === 'delivery' && (
        <Block title="Garantia">
          {os.warrantyUntil ? (
            <p>
              {os.warrantyDays} dias, até {formatDate(os.warrantyUntil)}.
            </p>
          ) : (
            <p>Sem garantia para este atendimento.</p>
          )}
        </Block>
      )}

      {terms && <p className="mt-2 text-[0.95em] whitespace-pre-line">{terms}</p>}
      {kind !== 'quote' && (
        <div className="mt-8 text-center">
          <div className="mx-auto w-4/5 border-t border-black" />
          <p className="mt-1">Assinatura do cliente</p>
        </div>
      )}
      {settings?.receiptFooter && kind === 'delivery' && <p className="mt-3 border-t border-dashed border-black pt-2 text-center whitespace-pre-line">{settings.receiptFooter}</p>}
    </div>
  );
}

function printMessage(os: ServiceOrderDetail, kind: OsPrintKind, settings: StoreSettings | undefined): string {
  if (kind === 'entry') return osMessage(DEFAULT_TEMPLATES.received, os, settings);
  if (kind === 'delivery') return osMessage(DEFAULT_TEMPLATES.delivered, os, settings);
  const lines = os.items.map((item) => `• ${item.qty}x ${item.name}: ${formatMoney(item.totalCents)}`);
  const discount = os.discountCents > 0 ? [`Desconto: −${formatMoney(os.discountCents)}`] : [];
  return [osMessage(DEFAULT_TEMPLATES.quoteSent, os, settings), '', ...lines, ...discount, `Total: ${formatMoney(os.totalCents)}`].join('\n');
}

export function OsPrintDialog({ os, kind, open, onOpenChange }: { os: ServiceOrderDetail; kind: OsPrintKind; open: boolean; onOpenChange(open: boolean): void }) {
  const settings = useStoreSettings();
  const queryClient = useQueryClient();
  const openWhatsapp = useOsWhatsapp();
  const [size, setSize] = useState<PrintSize>('80mm');
  useEffect(() => {
    if (settings.data) setSize(settings.data.printDefaultSize);
  }, [settings.data]);
  const hasPhone = Boolean(os.customer.phoneE164) && !os.customer.anonymizedAt;

  const print = () => {
    printNow(size);
    void api
      .post(`/api/service-orders/${os.id}/print`, { kind })
      .then(() => queryClient.invalidateQueries({ queryKey: ['service-order', os.id] }))
      .catch(() => undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        title={`${OS_PRINT_LABELS[kind]} · ${os.number}`}
        description={kind === 'entry' ? 'Via do cliente, com o termo de entrada.' : kind === 'delivery' ? 'Com o prazo e o termo de garantia.' : 'Itens, desconto e total.'}
        footer={
          <>
            <Button disabled={!hasPhone} title={hasPhone ? undefined : 'Cliente sem WhatsApp'} onClick={() => openWhatsapp(os.id, os.customer.phoneE164, printMessage(os, kind, settings.data), `print:${kind}`)}>
              <MessageCircle /> WhatsApp
            </Button>
            <Button variant="primary" onClick={print}>
              <Printer /> Imprimir
            </Button>
          </>
        }
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-sm text-muted">Papel</span>
          <PrintSizePicker value={size} onChange={setSize} />
        </div>
        <PaperPreview size={size}>
          <OsDocument os={os} kind={kind} settings={settings.data} size={size} />
        </PaperPreview>
        {open && (
          <PrintPortal>
            <OsDocument os={os} kind={kind} settings={settings.data} size={size} />
          </PrintPortal>
        )}
      </DialogContent>
    </Dialog>
  );
}
