import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStoreSettings } from '@/components/layout/app-shell.tsx';
import { SectionLoader } from '@/components/layout/loader.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { PercentInput } from '@/components/ui/masked.tsx';
import { EmptyState } from '@/components/ui/misc.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import type { ExpenseCategory } from '@/lib/types.ts';
import { useToast } from '@/lib/toast.tsx';
import { SaveButton, SettingsSection } from './shared.tsx';

interface DefaultsForm {
  warrantyDays: number;
  quoteValidityDays: number;
  staleOsDays: number;
  staleQuoteDays: number;
}

const DEFAULT_FIELDS: { key: keyof DefaultsForm; label: string; hint: string; suffix: string }[] = [
  { key: 'warrantyDays', label: 'Garantia do serviço', hint: 'Conta a partir da entrega da OS', suffix: 'dias' },
  { key: 'quoteValidityDays', label: 'Validade do orçamento', hint: 'Orçamentos de venda e de OS', suffix: 'dias' },
  { key: 'staleOsDays', label: 'OS parada', hint: 'Card ganha alerta depois de tantos dias sem mudar de coluna', suffix: 'dias' },
  { key: 'staleQuoteDays', label: 'Aguardando aprovação', hint: 'Alerta para orçamento de OS sem resposta do cliente', suffix: 'dias' },
];

function GeneralDefaults() {
  const settings = useStoreSettings();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<DefaultsForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings.data) {
      const { warrantyDays, quoteValidityDays, staleOsDays, staleQuoteDays } = settings.data;
      setForm({ warrantyDays, quoteValidityDays, staleOsDays, staleQuoteDays });
    }
  }, [settings.data]);

  if (!form || !settings.data) return <SectionLoader />;
  const dirty = DEFAULT_FIELDS.some(({ key }) => form[key] !== settings.data![key]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await api.put('/api/settings/defaults', form);
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Padrões salvos');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION') setErrors(error.fieldErrors());
      else toast.error('Não foi possível salvar', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <SettingsSection title="Prazos" footer={<SaveButton loading={saving} dirty={dirty} />}>
        <div className="grid gap-4 sm:grid-cols-2">
          {DEFAULT_FIELDS.map((field) => (
            <Field key={field.key} label={field.label} hint={field.hint} error={errors[field.key]}>
              <div className="relative">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="num pr-12"
                  value={Number.isNaN(form[field.key]) ? '' : form[field.key]}
                  onChange={(event) => setForm({ ...form, [field.key]: event.target.value === '' ? Number.NaN : Math.trunc(Number(event.target.value)) })}
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">{field.suffix}</span>
              </div>
            </Field>
          ))}
        </div>
      </SettingsSection>
    </form>
  );
}

function DiscountLimits() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const limits = useQuery({
    queryKey: ['discount-limits'],
    queryFn: () => api.get<{ id: string; name: string; discountLimitBps: number }[]>('/api/settings/discount-limits'),
  });
  const [draft, setDraft] = useState<Record<string, number>>({});

  useEffect(() => {
    if (limits.data) setDraft(Object.fromEntries(limits.data.map((role) => [role.id, role.discountLimitBps])));
  }, [limits.data]);

  const save = useMutation({
    mutationFn: () => api.put('/api/settings/discount-limits', { limits: Object.entries(draft).map(([roleId, discountLimitBps]) => ({ roleId, discountLimitBps })) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['discount-limits'] });
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Limites de desconto salvos');
    },
    onError: (error) => toast.error('Não foi possível salvar', errorMessage(error)),
  });

  if (limits.isPending) return <SectionLoader />;
  const dirty = (limits.data ?? []).some((role) => draft[role.id] !== role.discountLimitBps);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <SettingsSection
        title="Limite de desconto por perfil"
        description="Acima do limite, o PDV pede a senha de alguém com permissão para liberar."
        footer={<SaveButton loading={save.isPending} dirty={dirty} />}
      >
        <ul className="grid gap-3 sm:grid-cols-2">
          {(limits.data ?? []).map((role) => (
            <li key={role.id} className="flex items-center justify-between gap-3">
              <label htmlFor={`limit-${role.id}`} className="text-sm">
                {role.name}
              </label>
              <PercentInput
                id={`limit-${role.id}`}
                className="w-28"
                inputClassName="h-9"
                value={draft[role.id] ?? 0}
                onValueChange={(bps) => setDraft({ ...draft, [role.id]: Math.min(bps, 10000) })}
              />
            </li>
          ))}
        </ul>
      </SettingsSection>
    </form>
  );
}

function ExpenseCategories() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ['expense-categories'], queryFn: () => api.get<ExpenseCategory[]>('/api/expense-categories') });
  const [editing, setEditing] = useState<ExpenseCategory | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();

  const save = useMutation({
    mutationFn: (payload: { id?: string; name: string; active: boolean }) =>
      payload.id ? api.put(`/api/expense-categories/${payload.id}`, payload) : api.post('/api/expense-categories', payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      setEditing(undefined);
    },
    onError: (err) => {
      if (editing !== undefined) setError(errorMessage(err));
      else toast.error('Não foi possível salvar', errorMessage(err));
    },
  });

  const open = (category: ExpenseCategory | null) => {
    setEditing(category);
    setName(category?.name ?? '');
    setError(undefined);
  };

  return (
    <>
      <SettingsSection
        title="Categorias de custo"
        description="Usadas ao lançar custos e despesas no caixa (aluguel, peças, motoboy…). Desative em vez de excluir."
        footer={
          <Button variant="secondary" onClick={() => open(null)}>
            <Plus /> Nova categoria
          </Button>
        }
      >
        {categories.isPending ? (
          <SectionLoader />
        ) : (categories.data ?? []).length === 0 ? (
          <EmptyState title="Nenhuma categoria" description="Crie categorias para organizar os custos no relatório." />
        ) : (
          <ul className="divide-y divide-border">
            {categories.data!.map((category) => (
              <li key={category.id} className="flex items-center justify-between gap-3 py-2">
                <span className={category.active ? 'text-sm' : 'text-sm text-muted line-through'}>{category.name}</span>
                <div className="flex items-center gap-2">
                  <Switch
                    aria-label={category.active ? `Desativar ${category.name}` : `Ativar ${category.name}`}
                    checked={category.active}
                    onCheckedChange={(active) => save.mutate({ id: category.id, name: category.name, active })}
                  />
                  <Button variant="ghost" size="icon-sm" aria-label={`Renomear ${category.name}`} onClick={() => open(category)}>
                    <Pencil />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
      <Dialog open={editing !== undefined} onOpenChange={(value) => !value && setEditing(undefined)}>
        <DialogContent
          title={editing ? 'Renomear categoria de custo' : 'Nova categoria de custo'}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(undefined)}>
                Cancelar
              </Button>
              <Button variant="primary" type="submit" form="expense-category-form" loading={save.isPending}>
                Salvar
              </Button>
            </>
          }
        >
          <form
            id="expense-category-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return setError('Nome é obrigatório');
              save.mutate({ id: editing?.id, name, active: editing?.active ?? true });
            }}
          >
            <Field label="Nome" required error={error}>
              <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DefaultsTab() {
  return (
    <>
      <GeneralDefaults />
      <DiscountLimits />
      <ExpenseCategories />
    </>
  );
}
