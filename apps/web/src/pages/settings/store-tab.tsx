import { useQueryClient } from '@tanstack/react-query';
import { ImageUp, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useStoreSettings } from '@/components/layout/app-shell.tsx';
import { SectionLoader } from '@/components/layout/loader.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input, Textarea } from '@/components/ui/input.tsx';
import { maskDocument, PhoneInput } from '@/components/ui/masked.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import type { StoreSettings } from '@/lib/types.ts';
import { useToast } from '@/lib/toast.tsx';
import { storeInitial } from '@/lib/utils.ts';
import { SaveButton, SettingsSection } from './shared.tsx';

interface StoreForm {
  name: string;
  document: string;
  address: string;
  whatsapp: string;
  logoUrl: string;
  pixKey: string;
  openingHours: string;
}

function fromSettings(settings: StoreSettings): StoreForm {
  return {
    name: settings.name,
    document: maskDocument(settings.document ?? ''),
    address: settings.address ?? '',
    whatsapp: settings.whatsapp ?? '',
    logoUrl: settings.logoUrl ?? '',
    pixKey: settings.pixKey ?? '',
    openingHours: settings.openingHours ?? '',
  };
}

export function StoreTab() {
  const settings = useStoreSettings();
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<StoreForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (settings.data) setForm(fromSettings(settings.data));
  }, [settings.data]);

  if (!form || !settings.data) return <SectionLoader />;
  const initial = fromSettings(settings.data);
  const dirty = JSON.stringify(initial) !== JSON.stringify(form);
  const set = <K extends keyof StoreForm>(key: K, value: StoreForm[K]) => setForm((current) => (current ? { ...current, [key]: value } : current));

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const data = new FormData();
      data.append('file', file);
      const result = await api.post<{ url: string }>('/api/uploads', data);
      set('logoUrl', result.url);
    } catch (error) {
      toast.error('Não foi possível enviar o logo', errorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await api.put('/api/settings/store', {
        ...form,
        document: form.document || null,
        whatsapp: form.whatsapp || null,
        logoUrl: form.logoUrl || null,
      });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      await queryClient.invalidateQueries({ queryKey: ['public-store'] });
      toast.success('Dados da loja salvos');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION') setErrors(error.fieldErrors());
      else toast.error('Não foi possível salvar', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <SettingsSection
        title="Identidade"
        description="Aparece no topo do sistema, no login, nos comprovantes e nas mensagens."
        footer={<SaveButton loading={saving} dirty={dirty} />}
      >
        <div className="grid gap-4 md:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-2">
            <div className="grid size-24 place-items-center overflow-hidden rounded-lg border border-border bg-surface-2">
              {form.logoUrl ? (
                <img src={form.logoUrl} alt="Logo da loja" className="size-full object-contain" />
              ) : (
                <span className="text-3xl font-semibold text-muted">{storeInitial(form.name)}</span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = '';
              }}
            />
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
                <ImageUp /> Logo
              </Button>
              {form.logoUrl && (
                <Button size="icon-sm" variant="ghost" aria-label="Remover logo" onClick={() => set('logoUrl', '')}>
                  <Trash2 />
                </Button>
              )}
            </div>
            <p className="text-center text-xs text-muted">PNG, JPG ou WEBP até 2 MB</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome da loja" required error={errors.name} className="sm:col-span-2">
              <Input value={form.name} onChange={(event) => set('name', event.target.value)} />
            </Field>
            <Field label="CNPJ ou CPF" error={errors.document} hint="Opcional, sai no comprovante">
              <Input inputMode="numeric" value={form.document} onChange={(event) => set('document', maskDocument(event.target.value))} />
            </Field>
            <Field label="WhatsApp da loja" error={errors.whatsapp}>
              <PhoneInput value={form.whatsapp} onValueChange={(value) => set('whatsapp', value)} />
            </Field>
            <Field label="Endereço" error={errors.address} className="sm:col-span-2">
              <Input value={form.address} onChange={(event) => set('address', event.target.value)} placeholder="Rua, número - Bairro, Cidade/UF" />
            </Field>
            <Field label="Chave Pix" error={errors.pixKey} hint="Mostrada no comprovante e no orçamento">
              <Input value={form.pixKey} onChange={(event) => set('pixKey', event.target.value)} />
            </Field>
            <Field label="Horário de funcionamento" error={errors.openingHours}>
              <Textarea rows={2} value={form.openingHours} onChange={(event) => set('openingHours', event.target.value)} placeholder="Seg a sex, 9h às 18h · Sáb, 9h às 13h" />
            </Field>
          </div>
        </div>
      </SettingsSection>
    </form>
  );
}
