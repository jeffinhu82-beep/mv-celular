import { chargeFor, findFeeRule, formatMoney, MAX_CREDIT_INSTALLMENTS, PAYMENT_METHOD_LABELS, simulateInstallments, type FeeConfig, type PaymentMethod } from '@loja/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { SectionLoader } from '@/components/layout/loader.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Field } from '@/components/ui/field.tsx';
import { NativeSelect } from '@/components/ui/input.tsx';
import { MoneyInput, PercentInput } from '@/components/ui/masked.tsx';
import { Badge } from '@/components/ui/misc.tsx';
import { api, errorMessage } from '@/lib/api.ts';
import type { FeeRuleRow, FeeSettings } from '@/lib/types.ts';
import { useToast } from '@/lib/toast.tsx';
import { SaveButton, SettingsSection } from './shared.tsx';

const SINGLE_METHODS: PaymentMethod[] = ['cash', 'pix', 'debit'];

function rowsFor(config: FeeSettings, maxInstallments: number): FeeRuleRow[] {
  const asConfig: FeeConfig = config;
  const rows = SINGLE_METHODS.map((method) => ({ ...findFeeRule(asConfig, method, 1), method, installments: 1 }));
  for (let installments = 1; installments <= maxInstallments; installments += 1) {
    rows.push({ ...findFeeRule(asConfig, 'credit', installments), method: 'credit', installments });
  }
  return rows;
}

function rowLabel(row: FeeRuleRow) {
  if (row.method !== 'credit') return PAYMENT_METHOD_LABELS[row.method];
  return row.installments === 1 ? 'Crédito à vista' : `Crédito ${row.installments}x`;
}

export function FeesTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fees = useQuery({ queryKey: ['fees'], queryFn: () => api.get<FeeSettings>('/api/settings/fees') });
  const [draft, setDraft] = useState<FeeSettings | null>(null);
  const [simulateCents, setSimulateCents] = useState(30000);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (fees.data) setDraft({ ...fees.data, rules: rowsFor(fees.data, fees.data.maxInstallments) });
  }, [fees.data]);

  const simulation = useMemo(() => (draft ? simulateInstallments(simulateCents, draft) : []), [draft, simulateCents]);

  if (!draft || !fees.data) return <SectionLoader />;
  const initial = { ...fees.data, rules: rowsFor(fees.data, fees.data.maxInstallments) };
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);

  const updateRow = (index: number, patch: Partial<FeeRuleRow>) =>
    setDraft({ ...draft, rules: draft.rules.map((row, position) => (position === index ? { ...row, ...patch } : row)) });

  const setMaxInstallments = (value: number) => {
    const merged: FeeSettings = { ...draft, maxInstallments: value };
    const base = { ...merged, rules: [...draft.rules, ...(fees.data?.rules ?? [])] };
    setDraft({ ...merged, rules: rowsFor(base, value) });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.put('/api/settings/fees', draft);
      await queryClient.invalidateQueries({ queryKey: ['fees'] });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Taxas salvas', 'Valem para as próximas vendas. Vendas já feitas mantêm a taxa da época.');
    } catch (error) {
      toast.error('Não foi possível salvar', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <SettingsSection
        title="Taxas por forma de pagamento"
        description={
          <>
            Taxa = percentual × valor + valor fixo. Com <strong className="text-text">repassar ao cliente</strong>, o PDV cobra a mais para a loja receber o valor cheio.
          </>
        }
        footer={<SaveButton loading={saving} dirty={dirty} />}
      >
        <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:max-w-xl">
          <Field label="Máximo de parcelas no crédito">
            <NativeSelect value={draft.maxInstallments} onChange={(event) => setMaxInstallments(Number(event.target.value))}>
              {Array.from({ length: MAX_CREDIT_INSTALLMENTS }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>
                  {value === 1 ? 'Só à vista' : `Até ${value}x`}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Parcela mínima" hint="R$ 0,00 = sem mínimo">
            <MoneyInput value={draft.minInstallmentCents} onValueChange={(cents) => setDraft({ ...draft, minInstallmentCents: cents })} />
          </Field>
        </div>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Forma
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Percentual
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Fixo por transação
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Repassar ao cliente
                </th>
              </tr>
            </thead>
            <tbody>
              {draft.rules.map((row, index) => (
                <tr key={`${row.method}-${row.installments}`} className="border-b border-border/60">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {rowLabel(row)}
                  </th>
                  <td className="px-3 py-2">
                    <PercentInput aria-label={`Percentual ${rowLabel(row)}`} className="w-28" inputClassName="h-9" max={9999} value={row.percentBps} onValueChange={(bps) => updateRow(index, { percentBps: bps })} />
                  </td>
                  <td className="px-3 py-2">
                    <MoneyInput aria-label={`Valor fixo ${rowLabel(row)}`} className="h-9 w-32" value={row.fixedCents} onValueChange={(cents) => updateRow(index, { fixedCents: cents })} />
                  </td>
                  <td className="px-3 py-2">
                    {row.method === 'cash' ? (
                      <span className="text-xs text-muted">—</span>
                    ) : (
                      <Switch aria-label={`Repassar taxa ${rowLabel(row)}`} checked={row.passToCustomer} onCheckedChange={(checked) => updateRow(index, { passToCustomer: checked })} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>
      <SettingsSection title="Simulador" description="Como fica uma venda com as taxas acima (ainda sem salvar).">
        <Field label="Valor da venda" className="mb-4 max-w-xs">
          <MoneyInput value={simulateCents} onValueChange={setSimulateCents} />
        </Field>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Forma
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Cliente paga
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Parcela
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Taxa
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Loja recebe
                </th>
              </tr>
            </thead>
            <tbody className="num">
              {SINGLE_METHODS.map((method) => {
                const charge = chargeFor(simulateCents, findFeeRule(draft, method, 1));
                return (
                  <tr key={method} className="border-b border-border/60">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      {PAYMENT_METHOD_LABELS[method]}
                    </th>
                    <td className="px-3 py-2 text-right">{formatMoney(charge.chargedCents)}</td>
                    <td className="px-3 py-2 text-right text-muted">—</td>
                    <td className="px-3 py-2 text-right">{charge.feeCents ? formatMoney(-charge.feeCents) : formatMoney(0)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatMoney(charge.netCents)}</td>
                  </tr>
                );
              })}
              {simulation.map((option) => (
                <tr key={option.installments} className="border-b border-border/60">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    Crédito {option.installments}x {!option.allowed && <Badge tone="muted">abaixo da parcela mínima</Badge>}
                  </th>
                  <td className="px-3 py-2 text-right">{formatMoney(option.chargedCents)}</td>
                  <td className="px-3 py-2 text-right">
                    {option.installments}x {formatMoney(option.installmentCents)}
                  </td>
                  <td className="px-3 py-2 text-right">{option.feeCents ? formatMoney(-option.feeCents) : formatMoney(0)}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatMoney(option.netCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>
    </form>
  );
}
