import { formatMoney, formatPhoneBR, SALE_STATUS_LABELS, type SaleStatus } from '@loja/shared';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Loader2, Receipt, Search, UserSquare2 } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '@/lib/api.ts';
import { useDebounced } from '@/lib/hooks.ts';
import { cn, toQuery } from '@/lib/utils.ts';

interface SearchResult {
  customers: { id: string; name: string; phoneE164: string }[];
  serviceOrders: { id: string; number: string; brand: string; model: string; customer: { name: string }; column: { name: string; color: string } }[];
  sales: { id: string; number: string | null; quoteNumber: string | null; status: SaleStatus; totalCents: number; customer: { name: string } | null }[];
}

interface Entry {
  key: string;
  group: string;
  title: string;
  subtitle: string;
  to: string;
  icon: typeof Search;
}

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounced(q.trim(), 200);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResult>(`/api/search${toQuery({ q: debounced })}`),
    enabled: open && debounced.length >= 2,
    placeholderData: (previous) => previous,
  });

  const entries = useMemo<Entry[]>(() => {
    if (!results.data || debounced.length < 2) return [];
    return [
      ...results.data.customers.map((item) => ({
        key: `c-${item.id}`,
        group: 'Clientes',
        title: item.name,
        subtitle: formatPhoneBR(item.phoneE164),
        to: `/clientes/${item.id}`,
        icon: UserSquare2,
      })),
      ...results.data.serviceOrders.map((item) => ({
        key: `o-${item.id}`,
        group: 'Ordens de serviço',
        title: `${item.number} · ${item.brand} ${item.model}`,
        subtitle: `${item.customer.name} · ${item.column.name}`,
        to: `/os/${item.id}`,
        icon: ClipboardList,
      })),
      ...results.data.sales.map((item) => ({
        key: `s-${item.id}`,
        group: 'Vendas',
        title: item.number ?? item.quoteNumber ?? 'Venda',
        subtitle: `${item.customer?.name ?? 'Sem cliente'} · ${formatMoney(item.totalCents)} · ${SALE_STATUS_LABELS[item.status]}`,
        to: `/vendas/${item.id}`,
        icon: Receipt,
      })),
    ];
  }, [results.data, debounced]);

  useEffect(() => setActive(0), [entries.length]);

  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    onOpenChange(false);
    navigate(entry.to);
  };

  let lastGroup = '';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-fade-in fixed inset-0 z-50 bg-black/70" />
        <DialogPrimitive.Content
          className="fixed inset-x-0 top-0 z-50 mx-auto flex max-h-[80dvh] w-full max-w-xl flex-col overflow-hidden border border-border bg-surface shadow-2xl sm:top-[12vh] sm:rounded-md"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">Busca global</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-border px-4 pt-[env(safe-area-inset-top)]">
            {results.isFetching ? <Loader2 className="size-4 animate-spin text-muted" /> : <Search className="size-4 text-muted" aria-hidden />}
            <input
              autoFocus
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActive((index) => Math.min(entries.length - 1, index + 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActive((index) => Math.max(0, index - 1));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  go(entries[active]);
                }
              }}
              placeholder="Nome, telefone, CPF, nº da OS ou da venda"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
              role="combobox"
              aria-expanded={entries.length > 0}
              aria-controls="global-search-results"
              aria-activedescendant={entries[active]?.key}
            />
          </div>
          <div id="global-search-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
            {debounced.length < 2 && <p className="px-2 py-6 text-center text-sm text-muted">Digite pelo menos 2 letras.</p>}
            {debounced.length >= 2 && !results.isFetching && entries.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted">Nada encontrado para “{debounced}”.</p>
            )}
            {entries.map((entry, index) => {
              const header = entry.group !== lastGroup ? entry.group : null;
              lastGroup = entry.group;
              return (
                <div key={entry.key}>
                  {header && <p className="px-2 pt-2 pb-1 text-xs font-medium text-muted">{header}</p>}
                  <div
                    id={entry.key}
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(entry)}
                    className={cn('flex cursor-pointer items-center gap-3 rounded-md px-2 py-2', index === active && 'bg-surface-2')}
                  >
                    <entry.icon className="size-4 shrink-0 text-muted" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-sm">{entry.title}</p>
                      <p className="truncate text-xs text-muted">{entry.subtitle}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
