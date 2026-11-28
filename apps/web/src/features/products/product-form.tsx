import { formatBps, marginBps } from '@loja/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button.tsx';
import { SwitchField } from '@/components/ui/controls.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input, NativeSelect } from '@/components/ui/input.tsx';
import { MoneyInput } from '@/components/ui/masked.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';
import type { Category, Product } from '@/lib/types.ts';
import { useToast } from '@/lib/toast.tsx';

interface FormValues {
  name: string;
  sku: string;
  barcode: string;
  categoryId: string;
  costCents: number;
  priceCents: number;
  minStock: number;
  tracksStock: boolean;
  active: boolean;
  estimatedMinutes: number | null;
  photoUrl: string;
  initialStock: number;
}

const empty: FormValues = {
  name: '',
  sku: '',
  barcode: '',
  categoryId: '',
  costCents: 0,
  priceCents: 0,
  minStock: 0,
  tracksStock: true,
  active: true,
  estimatedMinutes: null,
  photoUrl: '',
  initialStock: 0,
};

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  type: 'product' | 'service';
  product?: Product | null;
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/api/categories'), staleTime: 60_000 });
}

export function ProductFormDialog({ open, onOpenChange, type, product }: ProductFormDialogProps) {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const form = useForm<FormValues>({ defaultValues: empty });
  const isService = type === 'service';
  const showCost = can('product.cost.view') && !isService;

  useEffect(() => {
    if (!open) return;
    form.reset(
      product
        ? {
            name: product.name,
            sku: product.sku ?? '',
            barcode: product.barcode ?? '',
            categoryId: product.categoryId ?? '',
            costCents: product.costCents ?? 0,
            priceCents: product.priceCents,
            minStock: product.minStock,
            tracksStock: product.tracksStock,
            active: product.active,
            estimatedMinutes: product.estimatedMinutes,
            photoUrl: product.photoUrl ?? '',
            initialStock: 0,
          }
        : { ...empty, tracksStock: !isService },
    );
  }, [open, product, isService, form]);

  const cost = form.watch('costCents');
  const price = form.watch('priceCents');
  const tracksStock = form.watch('tracksStock');
  const photoUrl = form.watch('photoUrl');
  const margin = marginBps(price, cost);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const data = new FormData();
      data.append('file', file);
      const result = await api.post<{ url: string }>('/api/uploads', data);
      form.setValue('photoUrl', result.url, { shouldDirty: true });
    } catch (error) {
      toast.error('Não foi possível enviar a foto', errorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const submit = form.handleSubmit(async (values) => {
    const payload = {
      type,
      name: values.name,
      sku: values.sku || null,
      barcode: isService ? null : values.barcode || null,
      categoryId: values.categoryId || null,
      costCents: isService ? 0 : values.costCents,
      priceCents: values.priceCents,
      minStock: isService ? 0 : Number(values.minStock) || 0,
      tracksStock: isService ? false : values.tracksStock,
      active: values.active,
      estimatedMinutes: isService && values.estimatedMinutes ? Number(values.estimatedMinutes) : null,
      photoUrl: values.photoUrl || null,
      ...(product ? {} : { initialStock: Number(values.initialStock) || 0 }),
    };
    try {
      if (product) await api.put(`/api/products/${product.id}`, payload);
      else await api.post('/api/products', payload);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      toast.success(product ? 'Alterações salvas' : isService ? 'Serviço cadastrado' : 'Produto cadastrado', values.name);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION') {
        for (const [path, message] of Object.entries(error.fieldErrors())) form.setError(path as keyof FormValues, { message });
      } else toast.error('Não foi possível salvar', errorMessage(error));
    }
  });

  const errors = form.formState.errors;
  const title = product ? (isService ? 'Editar serviço' : 'Editar produto') : isService ? 'Novo serviço' : 'Novo produto';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" form="product-form" loading={form.formState.isSubmitting}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="product-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Nome" required error={errors.name?.message} className="sm:col-span-2">
            <Input autoFocus {...form.register('name', { required: 'Nome é obrigatório' })} />
          </Field>
          {!isService && (
            <>
              <Field label="SKU" error={errors.sku?.message} hint="Código interno">
                <Input autoCapitalize="characters" {...form.register('sku')} />
              </Field>
              <Field label="Código de barras" error={errors.barcode?.message}>
                <Input inputMode="numeric" {...form.register('barcode')} />
              </Field>
            </>
          )}
          <Field label="Categoria" error={errors.categoryId?.message} className={isService ? 'sm:col-span-2' : undefined}>
            <NativeSelect {...form.register('categoryId')}>
              <option value="">Sem categoria</option>
              {categories.data?.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {isService ? (
            <Field label="Tempo estimado (min)" error={errors.estimatedMinutes?.message}>
              <Input type="number" min={0} inputMode="numeric" {...form.register('estimatedMinutes', { setValueAs: (value) => (value === '' ? null : Number(value)) })} />
            </Field>
          ) : (
            <Field label="Estoque mínimo" error={errors.minStock?.message} hint="Alerta quando ficar abaixo">
              <Input type="number" min={0} inputMode="numeric" {...form.register('minStock', { valueAsNumber: true })} />
            </Field>
          )}
          {showCost && (
            <Field label="Custo" error={errors.costCents?.message} hint={product ? 'Custo médio atual. Entradas de estoque recalculam.' : undefined}>
              <Controller control={form.control} name="costCents" render={({ field }) => <MoneyInput value={field.value} onValueChange={field.onChange} />} />
            </Field>
          )}
          <Field
            label={isService ? 'Preço padrão' : 'Preço de venda'}
            error={errors.priceCents?.message}
            hint={showCost ? (margin === null ? 'Margem: —' : `Margem: ${formatBps(margin)}`) : !isService && price === 0 ? 'Peças com preço zero só são usadas em OS' : undefined}
          >
            <Controller control={form.control} name="priceCents" render={({ field }) => <MoneyInput value={field.value} onValueChange={field.onChange} />} />
          </Field>
          {!isService && !product && tracksStock && (
            <Field label="Estoque inicial" error={errors.initialStock?.message}>
              <Input type="number" min={0} inputMode="numeric" {...form.register('initialStock', { valueAsNumber: true })} />
            </Field>
          )}
          {!isService && (
            <div className="flex items-center gap-3 sm:col-span-2">
              {photoUrl ? (
                <img src={photoUrl} alt="" className="size-16 rounded-md border border-border object-cover" />
              ) : (
                <div className="flex size-16 items-center justify-center rounded-md border border-dashed border-border text-muted">
                  <ImagePlus className="size-5" />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
                  {photoUrl ? 'Trocar foto' : 'Adicionar foto'}
                </Button>
                {photoUrl && (
                  <Button size="sm" variant="ghost" onClick={() => form.setValue('photoUrl', '', { shouldDirty: true })}>
                    <Trash2 /> Remover
                  </Button>
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
            </div>
          )}
          <div className="flex flex-col gap-3 rounded-md border border-border p-3 sm:col-span-2">
            {!isService && (
              <Controller
                control={form.control}
                name="tracksStock"
                render={({ field }) => (
                  <SwitchField label="Controla estoque" description="Desligue para itens sob encomenda" checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
            )}
            <Controller
              control={form.control}
              name="active"
              render={({ field }) => (
                <SwitchField label="Ativo" description="Itens inativos não aparecem no PDV nem na OS" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
