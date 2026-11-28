import { formatBps, formatMoney } from '@loja/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, FileUp, History, MoreHorizontal, Package, Pencil, Plus, SlidersHorizontal, TriangleAlert, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button.tsx';
import { SwitchField } from '@/components/ui/controls.tsx';
import { columnHelper, DataTable, Pagination } from '@/components/ui/data-table.tsx';
import { NativeSelect } from '@/components/ui/input.tsx';
import { SearchInput } from '@/components/ui/masked.tsx';
import { Card, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState } from '@/components/ui/misc.tsx';
import { ImportProductsDialog } from '@/features/products/import-dialog.tsx';
import { ProductFormDialog, useCategories } from '@/features/products/product-form.tsx';
import { StockAdjustDialog, StockEntryDialog } from '@/features/products/stock-dialogs.tsx';
import { api } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';
import { useDebounced } from '@/lib/hooks.ts';
import type { Paged, Product } from '@/lib/types.ts';
import { cn, toQuery } from '@/lib/utils.ts';

const PAGE_SIZE = 50;
const col = columnHelper<Product>();

export function ProductsTab({ type }: { type: 'product' | 'service' }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const categories = useCategories();
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [active, setActive] = useState<'true' | 'false' | 'all'>('true');
  const [params] = useSearchParams();
  const [lowStock, setLowStock] = useState(() => type === 'product' && params.get('estoque') === 'baixo');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [entry, setEntry] = useState<Product | null>(null);
  const [adjust, setAdjust] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);
  const debounced = useDebounced(q.trim());
  const isService = type === 'service';
  const showCost = can('product.cost.view') && !isService;
  const canManage = can('product.manage');
  const canStock = can('stock.manage');

  const filters = { type, q: debounced, categoryId, active, lowStock: lowStock ? 'true' : '', page, pageSize: PAGE_SIZE };
  const products = useQuery({
    queryKey: ['products', filters],
    queryFn: () => api.get<Paged<Product>>(`/api/products${toQuery(filters)}`),
    placeholderData: keepPreviousData,
  });
  const lowCount = useQuery({
    queryKey: ['products', 'low-stock-count'],
    queryFn: () => api.get<Paged<Product>>(`/api/products${toQuery({ type: 'product', lowStock: 'true', pageSize: 1 })}`),
    enabled: !isService,
  });

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: isService ? 'Serviço' : 'Produto',
        cell: (info) => {
          const product = info.row.original;
          return (
            <div className="flex items-center gap-3">
              {!isService &&
                (product.photoUrl ? (
                  <img src={product.photoUrl} alt="" className="size-9 shrink-0 rounded-md border border-border object-cover" />
                ) : (
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
                    <Package className="size-4" />
                  </div>
                ))}
              <div className="min-w-0">
                <p className={cn('font-medium', !product.active && 'text-muted')}>{product.name}</p>
                <p className="text-xs text-muted">
                  {[product.sku, product.category?.name].filter(Boolean).join(' · ') || 'Sem categoria'}
                  {!product.active && ' · inativo'}
                </p>
                {isService
                  ? product.estimatedMinutes ? <p className="text-xs text-muted sm:hidden">{product.estimatedMinutes} min</p> : null
                  : product.tracksStock && <p className={cn('text-xs sm:hidden', product.lowStock ? 'font-medium text-warning' : 'text-muted')}>Estoque {product.stockQty}</p>}
              </div>
            </div>
          );
        },
      }),
      ...(showCost
        ? [
            col.accessor('costCents', { header: 'Custo', meta: { align: 'right', className: 'hidden md:table-cell' }, cell: (info) => <span className="text-muted">{formatMoney(info.getValue() ?? 0)}</span> }),
          ]
        : []),
      col.accessor('priceCents', {
        header: isService ? 'Preço padrão' : 'Preço',
        meta: { align: 'right' },
        cell: (info) => (info.getValue() === 0 && !isService ? <span className="text-muted">só OS</span> : formatMoney(info.getValue())),
      }),
      ...(showCost
        ? [
            col.accessor('marginBps', {
              header: 'Margem',
              meta: { align: 'right', className: 'hidden md:table-cell' },
              cell: (info) => {
                const value = info.getValue();
                if (value === null || value === undefined) return <span className="text-muted">—</span>;
                return <span className={value < 0 ? 'text-primary-text' : value < 2000 ? 'text-warning' : undefined}>{formatBps(value)}</span>;
              },
            }),
          ]
        : []),
      isService
        ? col.accessor('estimatedMinutes', {
            header: 'Tempo estimado',
            meta: { align: 'right', className: 'hidden sm:table-cell' },
            cell: (info) => (info.getValue() ? `${info.getValue()} min` : <span className="text-muted">—</span>),
          })
        : col.accessor('stockQty', {
            header: 'Estoque',
            meta: { align: 'right', className: 'hidden sm:table-cell' },
            cell: (info) => {
              const product = info.row.original;
              if (!product.tracksStock) return <span className="text-muted">sem controle</span>;
              return (
                <div className="flex flex-col items-end">
                  <span className="inline-flex items-center gap-1.5">
                    {product.lowStock && <TriangleAlert className="size-3.5 text-warning" aria-label="Estoque baixo" />}
                    <span className={product.lowStock ? 'font-medium text-warning' : undefined}>{product.stockQty}</span>
                    <span className="text-xs text-muted">/ mín. {product.minStock}</span>
                  </span>
                  {product.reservedQty > 0 && <span className="text-xs text-info">{product.reservedQty} reservado(s) em OS</span>}
                </div>
              );
            },
          }),
      col.display({
        id: 'actions',
        header: () => <span className="sr-only">Ações</span>,
        meta: { align: 'right' },
        cell: (info) => {
          const product = info.row.original;
          const stockable = product.type === 'product' && product.tracksStock;
          if (!canManage && !(canStock && stockable)) return null;
          return (
            <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Ações de ${product.name}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {canManage && (
                    <DropdownMenuItem onSelect={() => setEditing(product)}>
                      <Pencil /> Editar
                    </DropdownMenuItem>
                  )}
                  {canStock && stockable && (
                    <>
                      <DropdownMenuItem onSelect={() => setEntry(product)}>
                        <ArrowDownToLine /> Entrada de estoque
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setAdjust(product)}>
                        <SlidersHorizontal /> Ajustar estoque
                      </DropdownMenuItem>
                    </>
                  )}
                  {stockable && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => navigate(`/produtos?aba=movimentacoes&produto=${product.id}`)}>
                        <History /> Ver movimentações
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      }),
    ],
    [isService, showCost, canManage, canStock, navigate],
  );

  const lowTotal = lowCount.data?.total ?? 0;
  const filtered = Boolean(debounced || categoryId || active !== 'true' || lowStock);

  return (
    <>
      {!isService && lowTotal > 0 && !lowStock && (
        <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <span className="flex items-center gap-2 text-warning">
            <TriangleAlert className="size-4" /> {lowTotal === 1 ? '1 produto está abaixo do estoque mínimo' : `${lowTotal} produtos estão abaixo do estoque mínimo`}
          </span>
          <Button size="sm" variant="secondary" onClick={() => resetPage(setLowStock)(true)}>
            Ver quais
          </Button>
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <SearchInput value={q} onValueChange={resetPage(setQ)} placeholder={isService ? 'Nome do serviço' : 'Nome, SKU ou código de barras'} className="w-full sm:max-w-xs" />
          <NativeSelect value={categoryId} onChange={(event) => resetPage(setCategoryId)(event.target.value)} className="w-full sm:w-48" aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {categories.data?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={active} onChange={(event) => resetPage(setActive)(event.target.value as typeof active)} className="w-full sm:w-36" aria-label="Situação">
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
            <option value="all">Todos</option>
          </NativeSelect>
          {!isService && (
            <div className="w-full sm:w-auto sm:pl-2">
              <SwitchField label="Só estoque baixo" checked={lowStock} onCheckedChange={resetPage(setLowStock)} />
            </div>
          )}
          {canManage && (
            <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
              {!isService && (
                <Button variant="secondary" onClick={() => setImporting(true)}>
                  <FileUp /> Importar CSV
                </Button>
              )}
              <Button variant="primary" onClick={() => setEditing(null)}>
                <Plus /> {isService ? 'Novo serviço' : 'Novo produto'}
              </Button>
            </div>
          )}
        </div>
        <DataTable
          columns={columns}
          data={products.data?.items ?? []}
          loading={products.isPending}
          getRowId={(row) => row.id}
          onRowClick={canManage ? (row) => setEditing(row) : undefined}
          empty={
            <EmptyState
              icon={isService ? Wrench : Package}
              title={filtered ? 'Nada encontrado com esses filtros' : isService ? 'Nenhum serviço cadastrado' : 'Nenhum produto cadastrado'}
              description={
                filtered
                  ? 'Limpe a busca ou troque os filtros.'
                  : isService
                    ? 'Cadastre os serviços mais comuns (troca de tela, bateria) para agilizar o orçamento.'
                    : 'Cadastre produtos e peças, ou importe uma planilha CSV.'
              }
              action={
                canManage &&
                !filtered && (
                  <Button variant="secondary" onClick={() => setEditing(null)}>
                    <Plus /> {isService ? 'Cadastrar serviço' : 'Cadastrar produto'}
                  </Button>
                )
              }
            />
          }
        />
        <Pagination page={page} pageSize={PAGE_SIZE} total={products.data?.total ?? 0} onPageChange={setPage} />
      </Card>
      <ProductFormDialog open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)} type={type} product={editing} />
      <StockEntryDialog product={entry} onOpenChange={(open) => !open && setEntry(null)} />
      <StockAdjustDialog product={adjust} onOpenChange={(open) => !open && setAdjust(null)} />
      <ImportProductsDialog open={importing} onOpenChange={setImporting} />
    </>
  );
}
