import { formatMoney } from '@loja/shared';
import { useQuery } from '@tanstack/react-query';
import { Barcode, PackageSearch } from 'lucide-react';
import { forwardRef, useEffect, useState } from 'react';
import { SearchInput } from '@/components/ui/masked.tsx';
import { api } from '@/lib/api.ts';
import { useDebounced } from '@/lib/hooks.ts';
import { useToast } from '@/lib/toast.tsx';
import type { Paged, Product } from '@/lib/types.ts';
import { cn, toQuery } from '@/lib/utils.ts';

export const ProductSearch = forwardRef<HTMLInputElement, { onPick(product: Product): void }>(function ProductSearch({ onPick }, ref) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(q.trim(), 200);
  const results = useQuery({
    queryKey: ['products', 'pos-search', debounced],
    queryFn: () => api.get<Paged<Product>>(`/api/products${toQuery({ q: debounced, pageSize: 8 })}`),
    enabled: debounced.length >= 2,
  });
  const items = debounced.length >= 2 ? (results.data?.items ?? []) : [];

  useEffect(() => setActive(0), [debounced]);

  const pick = (product: Product, term?: string) => {
    onPick(product);
    setQ((current) => (term === undefined || current.trim() === term ? '' : current));
    setOpen(false);
  };

  const submit = async (raw: string) => {
    const term = raw.trim();
    if (!term) return;
    setQ('');
    const looksLikeCode = /^\d{6,}$/.test(term) || (/\d/.test(term) && /^[\w.-]+$/.test(term));
    if (looksLikeCode) {
      const found = await api.get<{ product: Product | null }>(`/api/products/lookup${toQuery({ code: term })}`);
      if (found.product) {
        pick(found.product, '');
        return;
      }
    }
    const fresh = term === debounced && results.data ? results.data.items : (await api.get<Paged<Product>>(`/api/products${toQuery({ q: term, pageSize: 8 })}`)).items;
    const chosen = fresh[active] ?? (fresh.length === 1 ? fresh[0] : undefined);
    if (chosen) pick(chosen, '');
    else {
      setQ((current) => current || term);
      toast.error('Produto não encontrado', `Nada com "${term}". Confira o código ou busque pelo nome.`);
    }
  };

  return (
    <div className="relative">
      <SearchInput
        ref={ref}
        value={q}
        onValueChange={(value) => {
          setQ(value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void submit(event.currentTarget.value);
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
        placeholder="Buscar produto ou bipar código (F2)"
        aria-label="Buscar produto ou código de barras"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls="pos-product-results"
        autoComplete="off"
        className="w-full"
      />
      {open && debounced.length >= 2 && (
        <div id="pos-product-results" role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-surface shadow-xl">
          {items.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
              <PackageSearch className="size-4" /> {results.isFetching ? 'Buscando…' : 'Nenhum produto encontrado.'}
            </p>
          ) : (
            items.map((product, index) => {
              const out = product.tracksStock && product.availableQty <= 0;
              return (
                <button
                  key={product.id}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(product)}
                  onMouseEnter={() => setActive(index)}
                  className={cn('flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm', index === active && 'bg-surface-2')}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{product.name}</span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      {product.barcode && (
                        <span className="inline-flex items-center gap-1">
                          <Barcode className="size-3" /> {product.barcode}
                        </span>
                      )}
                      {product.type === 'service' ? 'Serviço' : product.tracksStock ? <span className={cn(out && 'text-warning')}>{out ? 'Sem estoque' : `${product.availableQty} em estoque`}</span> : 'Sem controle de estoque'}
                    </span>
                  </span>
                  <span className="num shrink-0 font-medium">{formatMoney(product.priceCents)}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
});
