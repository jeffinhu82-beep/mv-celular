import {
  DEFAULT_CHECKLIST,
  DEVICE_TYPES,
  formatDate,
  serviceOrderCreateSchema,
  serviceOrderUpdateSchema,
  UNLOCK_TYPE_LABELS,
  UNLOCK_TYPES,
  type UnlockType,
} from '@loja/shared';
import { useQuery } from '@tanstack/react-query';
import { Eraser } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm, type Path } from 'react-hook-form';
import { useStoreSettings } from '@/components/layout/app-shell.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input, NativeSelect, Textarea } from '@/components/ui/input.tsx';
import { CustomerPicker, type PickedCustomer } from '@/features/sales/customer-picker.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import { useToast } from '@/lib/toast.tsx';
import type { ServiceOrderDetail } from '@/lib/types.ts';
import { cn } from '@/lib/utils.ts';
import { fromLocalInput, toLocalInput } from './shared.tsx';

const NOTES_KEY = 'observacoes';

type Checklist = Record<string, boolean>;

interface OsFormValues {
  customer: PickedCustomer | null;
  deviceType: string;
  brand: string;
  model: string;
  color: string;
  serialImei: string;
  unlockType: UnlockType;
  unlockSecret: string;
  accessories: string;
  checklist: Checklist;
  notes: string;
  reportedIssue: string;
  diagnosis: string;
  dueAt: string;
  technicianId: string;
  warrantyDays: string;
  parentOsId: string;
}

const FIELD_FOR_PATH: Record<string, Path<OsFormValues>> = { customerId: 'customer' };

function booleanChecklist(value: Record<string, boolean | string>): Checklist {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry === 'boolean')) as Checklist;
}

function initialValues(os: ServiceOrderDetail | null | undefined, warrantyDays: number): OsFormValues {
  if (!os) {
    return {
      customer: null,
      deviceType: 'Celular',
      brand: '',
      model: '',
      color: '',
      serialImei: '',
      unlockType: 'none',
      unlockSecret: '',
      accessories: '',
      checklist: {},
      notes: '',
      reportedIssue: '',
      diagnosis: '',
      dueAt: '',
      technicianId: '',
      warrantyDays: String(warrantyDays),
      parentOsId: '',
    };
  }
  return {
    customer: { id: os.customer.id, name: os.customer.name, phoneE164: os.customer.phoneE164 },
    deviceType: os.deviceType,
    brand: os.brand,
    model: os.model,
    color: os.color ?? '',
    serialImei: os.serialImei ?? '',
    unlockType: os.unlockType,
    unlockSecret: '',
    accessories: os.accessories ?? '',
    checklist: booleanChecklist(os.checklist),
    notes: typeof os.checklist[NOTES_KEY] === 'string' ? (os.checklist[NOTES_KEY] as string) : '',
    reportedIssue: os.reportedIssue,
    diagnosis: os.diagnosis ?? '',
    dueAt: toLocalInput(os.dueAt),
    technicianId: os.technicianId ?? '',
    warrantyDays: String(os.warrantyDays),
    parentOsId: os.parentOsId ?? '',
  };
}

export function OsFormDialog({
  open,
  onOpenChange,
  os,
  staff,
  onSaved,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  os?: ServiceOrderDetail | null;
  staff: { id: string; name: string }[];
  onSaved(detail: ServiceOrderDetail): void;
}) {
  const editing = Boolean(os);
  const toast = useToast();
  const settings = useStoreSettings();
  const defaultWarranty = settings.data?.warrantyDays ?? 90;
  const form = useForm<OsFormValues>({ defaultValues: initialValues(os, defaultWarranty) });
  const { register, control, handleSubmit, formState, setError, watch, reset } = form;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) reset(initialValues(os, defaultWarranty));
  }, [open, os, defaultWarranty, reset]);

  const unlockType = watch('unlockType');
  const customer = watch('customer');

  const history = useQuery({
    queryKey: ['customer', customer?.id],
    queryFn: () => api.get<{ serviceOrders: { id: string; number: string; device: string; deliveredAt: string | null; warrantyUntil: string | null }[] }>(`/api/customers/${customer!.id}`),
    enabled: open && !editing && Boolean(customer),
    retry: false,
  });
  const delivered = (history.data?.serviceOrders ?? []).filter((entry) => entry.deliveredAt);

  const applyIssues = (issues: { path: string; message: string }[]) => {
    for (const issue of issues) {
      const field = FIELD_FOR_PATH[issue.path] ?? (issue.path as Path<OsFormValues>);
      setError(field, { message: issue.message });
    }
  };

  const submit = handleSubmit(async (values) => {
    const checklist: Record<string, boolean | string> = { ...values.checklist };
    if (values.notes.trim()) checklist[NOTES_KEY] = values.notes.trim();
    const warranty = values.warrantyDays.trim() === '' ? undefined : Number(values.warrantyDays);
    const common = {
      deviceType: values.deviceType,
      brand: values.brand,
      model: values.model,
      color: values.color,
      serialImei: values.serialImei,
      unlockType: values.unlockType,
      ...(values.unlockType !== 'none' && values.unlockSecret ? { unlockSecret: values.unlockSecret } : {}),
      accessories: values.accessories,
      checklist,
      reportedIssue: values.reportedIssue,
      dueAt: values.dueAt ? fromLocalInput(values.dueAt) : null,
      technicianId: values.technicianId || null,
      warrantyDays: warranty,
    };
    const payload = editing
      ? { ...common, customerId: values.customer?.id, diagnosis: values.diagnosis }
      : { ...common, customerId: values.customer?.id ?? '', parentOsId: values.parentOsId || null };
    const parsed = (editing ? serviceOrderUpdateSchema : serviceOrderCreateSchema).safeParse(payload);
    if (!parsed.success) {
      applyIssues(parsed.error.issues.map((issue) => ({ path: String(issue.path[0] ?? ''), message: issue.path[0] === 'customerId' ? 'Escolha o cliente' : issue.message })));
      return;
    }
    if (!editing && values.unlockType !== 'none' && !values.unlockSecret) {
      setError('unlockSecret', { message: 'Informe a senha ou o padrão' });
      return;
    }
    setSaving(true);
    try {
      const saved = editing ? await api.put<ServiceOrderDetail>(`/api/service-orders/${os!.id}`, payload) : await api.post<ServiceOrderDetail>('/api/service-orders', payload);
      toast.success(editing ? 'OS atualizada' : `OS ${saved.number} aberta`);
      onSaved(saved);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'APPROVAL_CANCELLED') return;
      if (error instanceof ApiError && error.details?.issues?.length) applyIssues(error.details.issues);
      toast.error(editing ? 'Não foi possível salvar a OS' : 'Não foi possível abrir a OS', errorMessage(error));
    } finally {
      setSaving(false);
    }
  });

  const errors = formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        title={editing ? `Editar ${os!.number}` : 'Nova OS'}
        description={editing ? 'Alterações ficam na linha do tempo.' : 'Entrada do aparelho na assistência.'}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={saving}>
              {saving ? 'Salvando…' : editing ? 'Salvar' : 'Abrir OS'}
            </Button>
          </>
        }
      >
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5" noValidate>
          <section className="flex flex-col gap-3">
            <Field label="Cliente" required error={errors.customer?.message}>
              <Controller control={control} name="customer" render={({ field }) => <CustomerPicker value={field.value} onChange={field.onChange} />} />
            </Field>
            {!editing && delivered.length > 0 && (
              <Field label="Retorno de garantia" hint="Ligue a uma OS já entregue para marcar como garantia.">
                <NativeSelect {...register('parentOsId')}>
                  <option value="">Não é retorno</option>
                  {delivered.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.number} · {entry.device}
                      {entry.warrantyUntil ? ` · garantia até ${formatDate(entry.warrantyUntil)}` : ' · sem garantia'}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <Field label="Tipo" required error={errors.deviceType?.message}>
              <NativeSelect {...register('deviceType')}>
                {DEVICE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Marca" required error={errors.brand?.message}>
              <Input {...register('brand')} placeholder="Samsung, Apple, Motorola…" autoComplete="off" />
            </Field>
            <Field label="Modelo" required error={errors.model?.message}>
              <Input {...register('model')} placeholder="Galaxy A54" autoComplete="off" />
            </Field>
            <Field label="Cor" error={errors.color?.message}>
              <Input {...register('color')} autoComplete="off" />
            </Field>
            <Field label="IMEI ou número de série" error={errors.serialImei?.message} className="sm:col-span-2">
              <Input {...register('serialImei')} inputMode="text" autoComplete="off" className="num" />
            </Field>
          </section>

          <section className="flex flex-col gap-3">
            <Field label="Desbloqueio" error={errors.unlockType?.message}>
              <Controller
                control={control}
                name="unlockType"
                render={({ field }) => (
                  <Segmented
                    label="Tipo de desbloqueio"
                    value={field.value}
                    onChange={(value) => {
                      field.onChange(value);
                      form.setValue('unlockSecret', '');
                    }}
                    options={UNLOCK_TYPES.map((type) => ({ value: type, label: UNLOCK_TYPE_LABELS[type] }))}
                    className="w-fit flex-wrap"
                  />
                )}
              />
            </Field>
            {unlockType !== 'none' && (
              <Field
                label={unlockType === 'pattern' ? 'Padrão' : unlockType === 'pin' ? 'PIN' : 'Senha'}
                error={errors.unlockSecret?.message}
                hint={editing && os?.hasSecret ? 'Deixe em branco para manter o que já está guardado.' : 'Fica cifrado. Só quem tem permissão consegue ver.'}
              >
                {unlockType === 'pattern' ? (
                  <Controller control={control} name="unlockSecret" render={({ field }) => <PatternInput value={field.value} onChange={field.onChange} />} />
                ) : (
                  <Input {...register('unlockSecret')} type="text" inputMode={unlockType === 'pin' ? 'numeric' : 'text'} autoComplete="off" className="num" spellCheck={false} />
                )}
              </Field>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <Field label="Defeito relatado" required error={errors.reportedIssue?.message}>
              <Textarea {...register('reportedIssue')} rows={3} placeholder="O que o cliente contou" />
            </Field>
            {editing && (
              <Field label="Diagnóstico" error={errors.diagnosis?.message}>
                <Textarea {...register('diagnosis')} rows={3} placeholder="O que o técnico encontrou" />
              </Field>
            )}
            <Field label="Acessórios entregues" error={errors.accessories?.message}>
              <Input {...register('accessories')} placeholder="Capa, chip, carregador…" />
            </Field>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Checklist de entrada</h3>
            <Controller control={control} name="checklist" render={({ field }) => <ChecklistEditor value={field.value} onChange={field.onChange} />} />
            <Field label="Observações do checklist">
              <Textarea {...register('notes')} rows={2} placeholder="Riscos, marcas, peças faltando…" />
            </Field>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <Field label="Previsão de entrega" error={errors.dueAt?.message}>
              <Input {...register('dueAt')} type="datetime-local" />
            </Field>
            <Field label="Técnico" error={errors.technicianId?.message}>
              <NativeSelect {...register('technicianId')}>
                <option value="">Sem técnico</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Garantia (dias)" error={errors.warrantyDays?.message}>
              <Input {...register('warrantyDays')} type="number" min={0} max={3650} inputMode="numeric" className="num" />
            </Field>
          </section>
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

const POINT_SPACING = 44;
const GRID_SIZE = POINT_SPACING * 3;

function pointCenter(point: number) {
  return { x: ((point - 1) % 3) * POINT_SPACING + POINT_SPACING / 2, y: Math.floor((point - 1) / 3) * POINT_SPACING + POINT_SPACING / 2 };
}

export function parsePattern(value: string): number[] {
  return value
    .split('-')
    .map(Number)
    .filter((point) => Number.isInteger(point) && point >= 1 && point <= 9);
}

export function PatternInput({ value, onChange, id }: { value: string; onChange?(value: string): void; id?: string }) {
  const points = parsePattern(value);
  const readOnly = !onChange;
  const toggle = (point: number) => {
    if (!onChange || points.includes(point)) return;
    onChange([...points, point].join('-'));
  };
  return (
    <div className="flex items-center gap-4" id={id}>
      <div className="relative shrink-0 rounded-lg border border-border bg-surface-2" style={{ width: GRID_SIZE, height: GRID_SIZE }} role="group" aria-label="Padrão de desbloqueio">
        <svg viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {points.length > 1 && (
            <polyline
              points={points.map((point) => `${pointCenter(point).x},${pointCenter(point).y}`).join(' ')}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.8}
            />
          )}
        </svg>
        {Array.from({ length: 9 }, (_, index) => index + 1).map((point) => {
          const order = points.indexOf(point);
          const center = pointCenter(point);
          const selected = order >= 0;
          return (
            <button
              key={point}
              type="button"
              disabled={readOnly}
              onClick={() => toggle(point)}
              aria-label={selected ? `Ponto ${point}, ${order + 1}º do padrão` : `Ponto ${point}`}
              aria-pressed={selected}
              className={cn(
                'absolute flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-default',
                selected ? 'bg-primary-solid text-white' : 'bg-surface-3 text-transparent hover:bg-border-strong',
              )}
              style={{ left: center.x, top: center.y }}
            >
              {selected ? order + 1 : '·'}
            </button>
          );
        })}
      </div>
      <div className="flex min-w-0 flex-col gap-2 text-sm">
        <span className="num text-muted">{points.length > 0 ? points.join(' → ') : readOnly ? 'Sem padrão' : 'Toque os pontos na ordem'}</span>
        {!readOnly && points.length > 0 && (
          <Button size="sm" variant="outline" className="w-fit" onClick={() => onChange?.('')}>
            <Eraser /> Limpar
          </Button>
        )}
      </div>
    </div>
  );
}

type CheckState = 'unknown' | 'ok' | 'bad';

const CHECK_OPTIONS: { value: CheckState; label: string; active: string }[] = [
  { value: 'unknown', label: '—', active: 'bg-surface-3 text-text' },
  { value: 'ok', label: 'OK', active: 'bg-success/20 text-success' },
  { value: 'bad', label: 'Defeito', active: 'bg-primary/15 text-primary-text' },
];

export function ChecklistEditor({ value, onChange }: { value: Checklist; onChange(value: Checklist): void }) {
  const items = [...DEFAULT_CHECKLIST, ...Object.keys(value).filter((key) => !(DEFAULT_CHECKLIST as readonly string[]).includes(key))];
  const stateOf = (item: string): CheckState => (value[item] === undefined ? 'unknown' : value[item] ? 'ok' : 'bad');
  const update = (item: string, state: CheckState) => {
    const next = { ...value };
    if (state === 'unknown') delete next[item];
    else next[item] = state === 'ok';
    onChange(next);
  };
  const markAll = () => onChange(Object.fromEntries(items.map((item) => [item, value[item] ?? true])));
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item} className="flex items-center justify-between gap-2 border-b border-border/60 py-1">
            <span className="min-w-0 truncate text-sm" title={item}>
              {item}
            </span>
            <div role="radiogroup" aria-label={item} className="inline-flex shrink-0 rounded-md border border-border bg-surface p-0.5">
              {CHECK_OPTIONS.map((option) => {
                const active = stateOf(item) === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={option.value === 'unknown' ? 'Não testado' : option.label}
                    onClick={() => update(item, option.value)}
                    className={cn(
                      'min-w-8 rounded px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                      active ? option.active : 'text-muted hover:text-text',
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <Button size="sm" variant="ghost" className="w-fit text-muted" onClick={markAll}>
        Marcar os não testados como OK
      </Button>
    </div>
  );
}
