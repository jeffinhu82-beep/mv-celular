import { APPROVAL_CHANNEL_LABELS, APPROVAL_CHANNELS, formatMoney, serviceOrderApprovalSchema, type ApprovalChannel } from '@loja/shared';
import { useEffect, useState } from 'react';
import { Segmented } from '@/components/ui/controls.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { MoneyInput } from '@/components/ui/masked.tsx';
import { useCashStatus } from '@/features/cash/queries.ts';
import { PaymentDialog, type PaymentSubmit } from '@/features/sales/payment-dialog.tsx';
import { ReceiptDialog } from '@/features/sales/receipt.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import { useToast } from '@/lib/toast.tsx';
import type { ServiceOrderDetail } from '@/lib/types.ts';
import { useRefreshServiceOrders, useServiceOrder } from './queries.ts';

function ignoreCancelled(error: unknown) {
  return error instanceof ApiError && error.code === 'APPROVAL_CANCELLED';
}

export function ApprovalDialog({ os, open, onOpenChange, onSaved }: { os: ServiceOrderDetail; open: boolean; onOpenChange(open: boolean): void; onSaved(detail: ServiceOrderDetail): void }) {
  const toast = useToast();
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [by, setBy] = useState('');
  const [channel, setChannel] = useState<ApprovalChannel>('whatsapp');
  const [fee, setFee] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDecision('approved');
    setBy(os.customer.name);
    setChannel('whatsapp');
    setFee(0);
    setError(null);
  }, [open, os.customer.name]);

  const submit = async () => {
    const parsed = serviceOrderApprovalSchema.safeParse({ decision, by, channel, diagnosisFeeCents: decision === 'rejected' ? fee : 0 });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira os dados');
      return;
    }
    setSaving(true);
    try {
      const saved = await api.post<ServiceOrderDetail>(`/api/service-orders/${os.id}/approval`, parsed.data);
      toast.success(decision === 'approved' ? 'Aprovação registrada' : 'Recusa registrada', saved.moved ? `A OS foi para "${saved.column.name}".` : undefined);
      onSaved(saved);
      onOpenChange(false);
    } catch (caught) {
      if (!ignoreCancelled(caught)) toast.error('Não foi possível registrar a resposta', errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const rejectHint =
    fee > 0
      ? `A OS vai para "Pronto para retirada" cobrando só a taxa de ${formatMoney(fee)}.`
      : os.depositCents > 0
        ? `Sem taxa, a OS é cancelada e o sinal de ${formatMoney(os.depositCents)} é estornado (pede autorização).`
        : 'Sem taxa, a OS é cancelada.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title="Resposta do orçamento"
        description={`${os.number} · total ${formatMoney(os.totalCents)}`}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant={decision === 'approved' ? 'primary' : 'danger'} onClick={() => void submit()} disabled={saving}>
              {saving ? 'Salvando…' : decision === 'approved' ? 'Registrar aprovação' : 'Registrar recusa'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Segmented
            label="Decisão do cliente"
            value={decision}
            onChange={(value) => setDecision(value as 'approved' | 'rejected')}
            options={[
              { value: 'approved', label: 'Aprovou' },
              { value: 'rejected', label: 'Recusou' },
            ]}
            className="w-fit"
          />
          <Field label="Quem respondeu" required error={error ?? undefined}>
            <Input value={by} onChange={(event) => setBy(event.target.value)} />
          </Field>
          <Field label="Por onde">
            <Segmented label="Canal" value={channel} onChange={(value) => setChannel(value as ApprovalChannel)} options={APPROVAL_CHANNELS.map((value) => ({ value, label: APPROVAL_CHANNEL_LABELS[value] }))} className="w-fit flex-wrap" />
          </Field>
          {decision === 'rejected' && (
            <Field label="Taxa de diagnóstico" hint={rejectHint}>
              <MoneyInput value={fee} onValueChange={setFee} />
            </Field>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DepositDialog({ os, open, onOpenChange, onSaved }: { os: ServiceOrderDetail; open: boolean; onOpenChange(open: boolean): void; onSaved(detail: ServiceOrderDetail): void }) {
  const toast = useToast();
  const submit = async ({ payments }: PaymentSubmit) => {
    try {
      const saved = await api.post<ServiceOrderDetail>(`/api/service-orders/${os.id}/deposit`, { payments });
      toast.success('Sinal registrado', `Falta ${formatMoney(saved.balanceCents)} para a entrega.`);
      onSaved(saved);
      onOpenChange(false);
    } catch (error) {
      if (!ignoreCancelled(error)) toast.error('Não foi possível registrar o sinal', errorMessage(error));
    }
  };
  return (
    <PaymentDialog
      open={open}
      onOpenChange={onOpenChange}
      dueCents={os.balanceCents}
      hasCustomer
      partial
      pendingAllowed={false}
      title={`Sinal · ${os.number}`}
      dueLabel="Saldo da OS"
      description={`Total da OS ${formatMoney(os.totalCents)} · já pago ${formatMoney(os.paidCents)}`}
      confirmLabel="Registrar sinal"
      onSubmit={submit}
    />
  );
}

function DeliverSummary({ os }: { os: ServiceOrderDetail }) {
  return (
    <div className="mb-4 rounded-lg border border-border bg-surface-2 p-3 text-sm">
      <ul className="flex flex-col gap-1">
        {os.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">
              {item.qty > 1 ? `${item.qty}× ` : ''}
              {item.name}
            </span>
            <span className="num shrink-0">{formatMoney(item.totalCents)}</span>
          </li>
        ))}
      </ul>
      {(os.discountCents > 0 || os.depositCents > 0) && (
        <dl className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          {os.discountCents > 0 && (
            <div className="flex justify-between text-muted">
              <dt>Desconto</dt>
              <dd className="num">−{formatMoney(os.discountCents)}</dd>
            </div>
          )}
          {os.depositCents > 0 && (
            <>
              <div className="flex justify-between font-medium">
                <dt>Total da OS</dt>
                <dd className="num">{formatMoney(os.totalCents)}</dd>
              </div>
              <div className="flex justify-between text-success">
                <dt>Sinal já pago</dt>
                <dd className="num">−{formatMoney(os.depositCents)}</dd>
              </div>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

export function DeliverFlow({ serviceOrderId, onClose, onDelivered }: { serviceOrderId: string | null; onClose(): void; onDelivered?(detail: ServiceOrderDetail): void }) {
  const toast = useToast();
  const refresh = useRefreshServiceOrders();
  const cash = useCashStatus();
  const detail = useServiceOrder(serviceOrderId);
  const [receipt, setReceipt] = useState<string | null>(null);
  const os = detail.data;
  const cashOpen = Boolean(cash.data?.session);
  const blocked = Boolean(serviceOrderId) && cash.isSuccess && !cashOpen;
  const notReady = os && (!os.open || os.column.stageType !== 'ready');

  useEffect(() => {
    if (!serviceOrderId) return;
    if (blocked) {
      toast.error('Caixa fechado', 'Abra o caixa para receber e entregar.');
      onClose();
    } else if (notReady) {
      toast.error('OS não está pronta', 'Mova a OS para "Pronto para retirada" antes de entregar.');
      onClose();
    }
  }, [serviceOrderId, blocked, notReady, toast, onClose]);

  const submit = async ({ payments, allowPending }: PaymentSubmit) => {
    if (!os) return;
    try {
      const saved = await api.post<ServiceOrderDetail>(`/api/service-orders/${os.id}/deliver`, { payments, allowPending });
      refresh(saved);
      const delivery = saved.delivery;
      if (delivery?.status === 'pending') toast.success('OS entregue com saldo a receber', `${formatMoney(delivery.pendingCents)} ficou em "A receber".`);
      else toast.success('OS entregue', delivery?.saleNumber ? `Venda ${delivery.saleNumber}.` : 'Sem valor a cobrar.');
      onDelivered?.(saved);
      onClose();
      if (delivery?.saleId) setReceipt(delivery.saleId);
    } catch (error) {
      if (!ignoreCancelled(error)) toast.error('Não foi possível entregar a OS', errorMessage(error));
    }
  };

  const ready = Boolean(os && serviceOrderId && cashOpen && !notReady);

  return (
    <>
      {os && (
        <PaymentDialog
          open={ready}
          onOpenChange={(open) => !open && onClose()}
          dueCents={os.balanceCents}
          hasCustomer
          title={`Receber e entregar · ${os.number}`}
          dueLabel={os.depositCents > 0 ? 'Saldo (sinal descontado)' : 'Total da OS'}
          description={`${os.customer.name} · ${os.brand} ${os.model}`.trim()}
          confirmLabel={os.balanceCents > 0 ? 'Receber e entregar' : 'Entregar'}
          summary={<DeliverSummary os={os} />}
          onSubmit={submit}
        />
      )}
      <ReceiptDialog saleId={receipt} open={receipt !== null} onOpenChange={(open) => !open && setReceipt(null)} />
    </>
  );
}
