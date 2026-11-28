import { zodResolver } from '@hookform/resolvers/zod';
import { customerSchema, formatPhoneBR, normalizePhoneBR } from '@loja/shared';
import { useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input, Textarea } from '@/components/ui/input.tsx';
import { maskCpf, PhoneInput } from '@/components/ui/masked.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import type { Customer } from '@/lib/types.ts';
import { useToast } from '@/lib/toast.tsx';

type FormValues = z.input<typeof customerSchema>;

interface Duplicate {
  id: string;
  name: string;
  phoneE164: string;
}

interface CustomerFormDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  customer?: Customer | null;
  initialName?: string;
  quick?: boolean;
  onSaved?(customer: Customer): void;
}

const empty: FormValues = { name: '', phone: '', cpf: '', email: '', address: '', notes: '' };

export function CustomerFormDialog({ open, onOpenChange, customer, initialName, quick, onSaved }: CustomerFormDialogProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const schema = quick ? customerSchema.pick({ name: true, phone: true }) : customerSchema;
  const form = useForm<FormValues>({ resolver: zodResolver(schema as typeof customerSchema), defaultValues: empty });

  useEffect(() => {
    if (!open) return;
    setDuplicates([]);
    form.reset(
      customer
        ? {
            name: customer.name,
            phone: formatPhoneBR(customer.phoneE164),
            cpf: customer.cpf ? maskCpf(customer.cpf) : '',
            email: customer.email ?? '',
            address: customer.address ?? '',
            notes: customer.notes ?? '',
          }
        : { ...empty, name: initialName ?? '' },
    );
  }, [open, customer, initialName, form]);

  const checkPhone = async (value: string) => {
    const phone = normalizePhoneBR(value);
    if (!phone) return setDuplicates([]);
    try {
      const result = await api.get<{ duplicates: Duplicate[] }>(
        `/api/customers/check-phone?phone=${encodeURIComponent(phone)}${customer ? `&exceptId=${customer.id}` : ''}`,
      );
      setDuplicates(result.duplicates);
    } catch {
      setDuplicates([]);
    }
  };

  const submit = form.handleSubmit(async (values) => {
    try {
      const payload = quick ? { name: values.name, phone: values.phone } : values;
      const url = customer ? `/api/customers/${customer.id}` : quick ? '/api/customers/quick' : '/api/customers';
      const result = customer ? await api.put<{ customer: Customer }>(url, payload) : await api.post<{ customer: Customer }>(url, payload);
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      if (customer) await queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });
      toast.success(customer ? 'Cliente atualizado' : 'Cliente cadastrado', result.customer.name);
      onSaved?.(result.customer);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION') {
        for (const [path, message] of Object.entries(error.fieldErrors())) form.setError(path as keyof FormValues, { message });
      } else {
        toast.error('Não foi possível salvar', errorMessage(error));
      }
    }
  });

  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={customer ? 'Editar cliente' : 'Novo cliente'}
        description={quick ? 'Cadastro rápido. Os outros dados podem ser completados depois na ficha.' : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" form="customer-form" loading={form.formState.isSubmitting}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="customer-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Nome" required error={errors.name?.message} className="sm:col-span-2">
            <Input autoFocus autoComplete="off" {...form.register('name')} />
          </Field>
          <Field label="WhatsApp" required error={errors.phone?.message} className={quick ? 'sm:col-span-2' : undefined}>
            <Controller
              control={form.control}
              name="phone"
              render={({ field }) => <PhoneInput value={field.value ?? ''} onValueChange={field.onChange} onBlur={() => { field.onBlur(); void checkPhone(field.value ?? ''); }} />}
            />
          </Field>
          {!quick && (
            <Field label="CPF" error={errors.cpf?.message} hint="Opcional">
              <Controller
                control={form.control}
                name="cpf"
                render={({ field }) => <Input inputMode="numeric" value={field.value ?? ''} onChange={(event) => field.onChange(maskCpf(event.target.value))} onBlur={field.onBlur} />}
              />
            </Field>
          )}
          {duplicates.length > 0 && (
            <div role="status" className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm sm:col-span-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div>
                <p className="font-medium text-warning">Já existe cliente com este telefone</p>
                <ul className="mt-1 space-y-0.5 text-muted">
                  {duplicates.map((item) => (
                    <li key={item.id}>
                      <Link to={`/clientes/${item.id}`} className="text-text underline-offset-2 hover:underline" onClick={() => onOpenChange(false)}>
                        {item.name}
                      </Link>{' '}
                      · {formatPhoneBR(item.phoneE164)}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted">Você pode salvar mesmo assim (ex.: duas pessoas da mesma família).</p>
              </div>
            </div>
          )}
          {!quick && (
            <>
              <Field label="E-mail" error={errors.email?.message} className="sm:col-span-2">
                <Input type="email" autoComplete="off" {...form.register('email')} />
              </Field>
              <Field label="Endereço" error={errors.address?.message} className="sm:col-span-2">
                <Input autoComplete="off" {...form.register('address')} />
              </Field>
              <Field label="Observações" error={errors.notes?.message} className="sm:col-span-2">
                <Textarea rows={3} {...form.register('notes')} />
              </Field>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
