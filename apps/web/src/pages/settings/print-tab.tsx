import { PRINT_SIZES, type PrintSize } from '@loja/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useStoreSettings } from '@/components/layout/app-shell.tsx';
import { SectionLoader } from '@/components/layout/loader.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Textarea } from '@/components/ui/input.tsx';
import { api, errorMessage } from '@/lib/api.ts';
import { cn } from '@/lib/utils.ts';
import { useToast } from '@/lib/toast.tsx';
import { SaveButton, SettingsSection } from './shared.tsx';

const SIZE_LABELS: Record<PrintSize, { title: string; hint: string }> = {
  '80mm': { title: 'Térmica 80 mm', hint: 'A mais comum no balcão' },
  '58mm': { title: 'Térmica 58 mm', hint: 'Impressoras portáteis' },
  A4: { title: 'A4', hint: 'Impressora comum' },
};

interface PrintForm {
  printDefaultSize: PrintSize;
  entryTerms: string;
  warrantyTerms: string;
  receiptFooter: string;
}

export function PrintTab() {
  const settings = useStoreSettings();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PrintForm | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings.data) {
      const { printDefaultSize, entryTerms, warrantyTerms, receiptFooter } = settings.data;
      setForm({ printDefaultSize, entryTerms, warrantyTerms, receiptFooter });
    }
  }, [settings.data]);

  if (!form || !settings.data) return <SectionLoader />;
  const dirty =
    form.printDefaultSize !== settings.data.printDefaultSize ||
    form.entryTerms !== settings.data.entryTerms ||
    form.warrantyTerms !== settings.data.warrantyTerms ||
    form.receiptFooter !== settings.data.receiptFooter;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.put('/api/settings/print', form);
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Impressão salva');
    } catch (error) {
      toast.error('Não foi possível salvar', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <SettingsSection title="Tamanho padrão" description="Dá para escolher outro tamanho na hora de imprimir.">
        <div role="radiogroup" aria-label="Tamanho padrão" className="grid gap-2 sm:grid-cols-3">
          {PRINT_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              role="radio"
              aria-checked={form.printDefaultSize === size}
              onClick={() => setForm({ ...form, printDefaultSize: size })}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary',
                form.printDefaultSize === size ? 'border-primary bg-primary/10' : 'border-border hover:bg-surface-2',
              )}
            >
              <p className="text-sm font-medium">{SIZE_LABELS[size].title}</p>
              <p className="text-xs text-muted">{SIZE_LABELS[size].hint}</p>
            </button>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection title="Textos" footer={<SaveButton loading={saving} dirty={dirty} />}>
        <div className="grid gap-4">
          <Field label="Termos de entrada do aparelho" hint="Sai no comprovante de entrada da OS, com espaço para assinatura.">
            <Textarea rows={5} value={form.entryTerms} onChange={(event) => setForm({ ...form, entryTerms: event.target.value })} />
          </Field>
          <Field label="Termos de garantia" hint="Sai no comprovante de entrega e no termo de garantia.">
            <Textarea rows={5} value={form.warrantyTerms} onChange={(event) => setForm({ ...form, warrantyTerms: event.target.value })} />
          </Field>
          <Field label="Rodapé do comprovante de venda">
            <Textarea rows={2} value={form.receiptFooter} onChange={(event) => setForm({ ...form, receiptFooter: event.target.value })} placeholder="Obrigado pela preferência!" />
          </Field>
        </div>
      </SettingsSection>
    </form>
  );
}
