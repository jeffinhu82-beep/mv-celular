import { formatPhoneBR } from '@loja/shared';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, UserSquare2, X } from 'lucide-react';
import { forwardRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { SearchInput } from '@/components/ui/masked.tsx';
import { CustomerFormDialog } from '@/features/customers/customer-form.tsx';
import { api } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';
import { useDebounced } from '@/lib/hooks.ts';
import type { Customer, Paged } from '@/lib/types.ts';
import { cn, toQuery } from '@/lib/utils.ts';

export interface PickedCustomer {
  id: string;
  name: string;
  phoneE164: string;
}

export const CustomerPicker = forwardRef<HTMLInputElement, { value: PickedCustomer | null; onChange(customer: PickedCustomer | null): void }>(function CustomerPicker(
  { value, onChange },
  ref,
) {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(q.trim(), 200);
  const results = useQuery({
    queryKey: ['customers', 'pos-search', debounced],
    queryFn: () => api.get<Paged<Customer>>(`/api/customers${toQuery({ q: debounced, pageSize: 6 })}`),
    enabled: debounced.length >= 2,
  });
  const items = debounced.length >= 2 ? (results.data?.items ?? []) : [];

  const pick = (customer: PickedCustomer) => {
    onChange({ id: customer.id, name: customer.name, phoneE164: customer.phoneE164 });
    setQ('');
    setOpen(false);
  };

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <UserSquare2 className="size-4 shrink-0 text-muted" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{value.name}</p>
            <p className="num text-xs text-muted">{formatPhoneBR(value.phoneE164)}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Remover cliente" onClick={() => onChange(null)}>
          <X />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <SearchInput
          ref={ref}
          value={q}
          onValueChange={(next) => {
            setQ(next);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              const chosen = items[active];
              if (chosen) pick(chosen);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, Math.max(items.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Escape' && (q || open)) {
              event.stopPropagation();
              setQ('');
              setOpen(false);
            }
          }}
          placeholder="Cliente: nome ou telefone (F4)"
          aria-label="Buscar cliente"
          role="combobox"
          aria-expanded={open && debounced.length >= 2}
          autoComplete="off"
          className="min-w-0 flex-1"
        />
        {can('customer.manage') && (
          <Button variant="secondary" size="icon" aria-label="Cadastrar cliente" title="Cadastro rápido" onClick={() => setCreating(true)}>
            <UserPlus />
          </Button>
        )}
      </div>
      {open && debounced.length >= 2 && (
        <div role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-surface shadow-xl">
          {items.length === 0 ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-muted">
              <span>{results.isFetching ? 'Buscando…' : 'Nenhum cliente encontrado.'}</span>
              {can('customer.manage') && !results.isFetching && (
                <Button size="sm" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => setCreating(true)}>
                  <UserPlus /> Cadastrar "{q.trim()}"
                </Button>
              )}
            </div>
          ) : (
            items.map((customer, index) => (
              <button
                key={customer.id}
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(customer)}
                onMouseEnter={() => setActive(index)}
                className={cn('flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm', index === active && 'bg-surface-2')}
              >
                <span className="truncate font-medium">{customer.name}</span>
                <span className="num shrink-0 text-xs text-muted">{formatPhoneBR(customer.phoneE164)}</span>
              </button>
            ))
          )}
        </div>
      )}
      <CustomerFormDialog open={creating} onOpenChange={setCreating} quick initialName={/\d{4,}/.test(q) ? '' : q.trim()} onSaved={pick} />
    </div>
  );
});
