import { formatDateTime, formatMoney, STOCK_MOVEMENT_LABELS, type StockMovementType } from '@loja/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { History, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button.tsx';
import { columnHelper, DataTable, Pagination } from '@/components/ui/data-table.tsx';
import { NativeSelect } from '@/components/ui/input.tsx';
import { Badge, Card, EmptyState } from '@/components/ui/misc.tsx';
import { api } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';
import type { Paged, Product, StockMovement } from '@/lib/types.ts';
import { toQuery } from '@/lib/utils.ts';

const PAGE_SIZE = 50;
const col = columnHelper<StockMovement>();

const TONES: Record<StockMovementType, 'success' | 'info' | 'warning' | 'neutral' | 'muted'> = {
  purchase: 'success',
  sale: 'info',
  os_use: 'info',
  adjust: 'warning',
  reversal: 'neutral',
};

function documentLink(movement: StockMovement) {
  if (!movement.refNumber) return null;
  if (movement.refType === 'Sale') return `/vendas/${movement.refId}`;
  if (movement.refType === 'ServiceOrder') return `/os/${movement.refId}`;
  return null;
}

export function MovementsTab({ productId, onClearProduct }: { productId: string | null; onClearProduct(): void }) {
  const { can } = useAuth();
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const showCost = can('product.cost.view');
  const filters = { productId: productId ?? '', type, page, pageSize: PAGE_SIZE };

  const movements = useQuery({
    queryKey: ['stock-movements', filters],
    queryFn: () => api.get<Paged<StockMovement>>(`/api/stock/movements${toQuery(filters)}`),
    placeholderData: keepPreviousData,
  });
  const product = useQuery({
    queryKey: ['products', 'one', productId],
    queryFn: () => api.get<Product>(`/api/products/${productId}`),
    enabled: Boolean(productId),
  });

  const columns = useMemo(
    () => [
      col.accessor('createdAt', { header: 'Data', meta: { className: 'hidden md:table-cell' }, cell: (info) => <span className="num text-muted">{formatDateTime(info.getValue())}</span> }),
      col.accessor((row) => row.product.name, {
        id: 'product',
        header: 'Produto',
        cell: (info) => (
          <div>
            <p className="font-medium">{info.getValue()}</p>
            <p className="num text-xs text-muted md:hidden">{formatDateTime(info.row.original.createdAt)}</p>
            <Badge tone={TONES[info.row.original.type]} className="mt-1 md:hidden">
              {STOCK_MOVEMENT_LABELS[info.row.original.type]}
            </Badge>
          </div>
        ),
      }),
      col.accessor('type', { header: 'Tipo', meta: { className: 'hidden md:table-cell' }, cell: (info) => <Badge tone={TONES[info.getValue()]}>{STOCK_MOVEMENT_LABELS[info.getValue()]}</Badge> }),
      col.accessor('qty', {
        header: 'Qtd.',
        meta: { align: 'right' },
        cell: (info) => {
          const value = info.getValue();
          return <span className={value < 0 ? 'text-primary-text' : 'text-success'}>{value > 0 ? `+${value}` : `−${Math.abs(value)}`}</span>;
        },
      }),
      ...(showCost
        ? [
            col.accessor('unitCostCents', {
              header: 'Custo unit.',
              meta: { align: 'right', className: 'hidden xl:table-cell' },
              cell: (info) => (info.getValue() === undefined || info.getValue() === null ? '—' : formatMoney(info.getValue()!)),
            }),
          ]
        : []),
      col.accessor('balanceAfter', { header: 'Saldo', meta: { align: 'right' } }),
      col.display({
        id: 'document',
        header: 'Documento / motivo',
        meta: { className: 'hidden xl:table-cell' },
        cell: (info) => {
          const movement = info.row.original;
          const link = documentLink(movement);
          const details = [movement.supplier && `Fornecedor: ${movement.supplier}`, movement.reason].filter(Boolean).join(' · ');
          return (
            <div className="max-w-xs">
              {movement.refNumber &&
                (link ? (
                  <Link to={link} className="num font-medium text-primary-text hover:underline">
                    {movement.refNumber}
                  </Link>
                ) : (
                  <span className="num font-medium">{movement.refNumber}</span>
                ))}
              {details && <p className="truncate text-xs text-muted" title={details}>{details}</p>}
            </div>
          );
        },
      }),
      col.accessor('userName', { header: 'Usuário', meta: { className: 'hidden xl:table-cell' }, cell: (info) => <span className="text-muted">{info.getValue() ?? 'Sistema'}</span> }),
    ],
    [showCost],
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        {productId && (
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 py-1 pr-1 pl-3 text-sm">
            {product.data?.name ?? 'Produto'}
            <Button variant="ghost" size="icon-sm" aria-label="Remover filtro de produto" onClick={onClearProduct}>
              <X />
            </Button>
          </span>
        )}
        <NativeSelect
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(1);
          }}
          className="w-full sm:w-48"
          aria-label="Tipo de movimentação"
        >
          <option value="">Todos os tipos</option>
          {Object.entries(STOCK_MOVEMENT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <DataTable
        columns={columns}
        data={movements.data?.items ?? []}
        loading={movements.isPending}
        getRowId={(row) => row.id}
        empty={<EmptyState icon={History} title="Nenhuma movimentação" description="Entradas, vendas, usos em OS e ajustes aparecem aqui." />}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={movements.data?.total ?? 0} onPageChange={setPage} />
    </Card>
  );
}
