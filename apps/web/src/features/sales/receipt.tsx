import { formatCpf, formatDateTime, formatDate, formatDocument, formatMoney, formatPhoneBR, type PrintSize } from '@loja/shared';
import { MessageCircle, Plus, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useStoreSettings } from '@/components/layout/app-shell.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Skeleton } from '@/components/ui/misc.tsx';
import { PaperPreview, PrintPortal, PrintSizePicker, PRINT_WIDTHS, printNow } from '@/features/print/print.tsx';
import { api } from '@/lib/api.ts';
import type { SaleDetail, StoreSettings } from '@/lib/types.ts';
import { cn } from '@/lib/utils.ts';
import { methodLabel, saleCode, saleWhatsappLink } from './shared.tsx';

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-2', strong && 'font-bold')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function SaleDocument({ sale, settings, size }: { sale: SaleDetail; settings: StoreSettings | undefined; size: PrintSize }) {
  const quote = sale.status === 'quote';
  const narrow = size !== 'A4';
  const activePayments = sale.payments.filter((payment) => !payment.reversedAt);
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
          <p className="font-bold">{quote ? 'ORÇAMENTO' : 'COMPROVANTE NÃO FISCAL'}</p>
          <p className="text-[1.1em] font-bold">{saleCode(sale)}</p>
          <p>{formatDateTime(quote ? sale.quoteCreatedAt : sale.completedAt)}</p>
          {sale.status === 'cancelled' && <p className="font-bold">VENDA CANCELADA</p>}
        </div>
      </div>

      <div className="border-b border-dashed border-black py-2">
        <p>Atendente: {sale.sellerName}</p>
        {sale.customer ? (
          <>
            <p>Cliente: {sale.customer.name}</p>
            {sale.customer.cpf && <p>CPF: {formatCpf(sale.customer.cpf)}</p>}
            <p>Telefone: {formatPhoneBR(sale.customer.phoneE164)}</p>
          </>
        ) : (
          <p>Cliente: consumidor</p>
        )}
        {sale.serviceOrder && <p>OS: {sale.serviceOrder.number}</p>}
      </div>

      <table className="my-2 w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-0.5 font-semibold">Item</th>
            <th className="py-0.5 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="py-0.5 pr-2">
                {item.name}
                <span className="block opacity-80">
                  {item.qty} x {formatMoney(item.unitPriceCents)}
                  {item.discountCents > 0 && ` − desc. ${formatMoney(item.discountCents)}`}
                </span>
              </td>
              <td className="py-0.5 text-right tabular-nums">{formatMoney(item.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t border-dashed border-black pt-2">
        {sale.discountCents > 0 && (
          <>
            <Row label="Subtotal" value={formatMoney(sale.subtotalCents)} />
            <Row label="Descontos" value={`−${formatMoney(sale.discountCents)}`} />
          </>
        )}
        <Row label="TOTAL" value={formatMoney(sale.totalCents)} strong />
      </div>

      {!quote && activePayments.length > 0 && (
        <div className="mt-2 border-t border-dashed border-black pt-2">
          {activePayments.map((payment) => (
            <div key={payment.id}>
              <Row label={methodLabel(payment.method, payment.installments)} value={formatMoney(payment.amountCents + payment.changeCents)} />
              {payment.surchargeCents > 0 && <p className="opacity-80">inclui acréscimo de {formatMoney(payment.surchargeCents)}</p>}
            </div>
          ))}
          {sale.changeCents > 0 && <Row label="Troco" value={formatMoney(sale.changeCents)} />}
          {sale.balanceCents > 0 && <Row label="Saldo a pagar" value={formatMoney(sale.balanceCents)} strong />}
        </div>
      )}

      {quote && (
        <div className="mt-2 border-t border-dashed border-black pt-2">
          <p>Válido até {formatDate(sale.quoteValidUntil)}. Preços e estoque conferidos novamente na compra.</p>
        </div>
      )}
      {sale.notes && <p className="mt-2">Obs.: {sale.notes}</p>}
      {settings?.pixKey && <p className="mt-2">Chave Pix: {settings.pixKey}</p>}
      {settings?.receiptFooter && <p className="mt-2 border-t border-dashed border-black pt-2 text-center whitespace-pre-line">{settings.receiptFooter}</p>}
    </div>
  );
}

export function useSale(id: string | null | undefined) {
  return useQuery({ queryKey: ['sale', id], queryFn: () => api.get<SaleDetail>(`/api/sales/${id}`), enabled: Boolean(id) });
}

export function ReceiptDialog({ saleId, open, onOpenChange, onNewSale }: { saleId: string | null; open: boolean; onOpenChange(open: boolean): void; onNewSale?(): void }) {
  const settings = useStoreSettings();
  const sale = useSale(open ? saleId : null);
  const [size, setSize] = useState<PrintSize>('80mm');
  useEffect(() => {
    if (settings.data) setSize(settings.data.printDefaultSize);
  }, [settings.data]);
  const link = sale.data ? saleWhatsappLink(sale.data, settings.data) : null;
  const quote = sale.data?.status === 'quote';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        title={quote ? `Orçamento ${sale.data?.quoteNumber ?? ''}` : `Comprovante ${sale.data?.number ?? ''}`}
        description={quote ? 'Imprima ou envie para o cliente pelo WhatsApp.' : 'Venda registrada. Imprima, envie pelo WhatsApp ou comece outra.'}
        footer={
          <>
            {onNewSale && (
              <Button variant="primary" onClick={onNewSale} autoFocus>
                <Plus /> Nova venda
              </Button>
            )}
            <Button
              disabled={!link}
              title={link ? undefined : 'Cliente sem WhatsApp cadastrado'}
              onClick={() => link && window.open(link, '_blank', 'noopener')}
            >
              <MessageCircle /> WhatsApp
            </Button>
            <Button onClick={() => printNow(size)} disabled={!sale.data}>
              <Printer /> Imprimir
            </Button>
          </>
        }
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-sm text-muted">Papel</span>
          <PrintSizePicker value={size} onChange={setSize} />
        </div>
        {sale.data ? (
          <>
            <PaperPreview size={size}>
              <SaleDocument sale={sale.data} settings={settings.data} size={size} />
            </PaperPreview>
            {open && (
              <PrintPortal>
                <SaleDocument sale={sale.data} settings={settings.data} size={size} />
              </PrintPortal>
            )}
          </>
        ) : (
          <Skeleton className="h-80 w-full" />
        )}
        {sale.data && !sale.data.customer?.phoneE164 && <p className="mt-3 text-xs text-muted">Para enviar pelo WhatsApp, a venda precisa de um cliente com telefone.</p>}
      </DialogContent>
    </Dialog>
  );
}
