import { createColumnHelper, tableFeatures, useTable, type ColumnDef, type RowData } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';
import { Button } from './button.tsx';
import { Skeleton } from './misc.tsx';

export const tableFeatureSet = tableFeatures({});
export type TableFeatures = typeof tableFeatureSet;

export function columnHelper<T extends RowData>() {
  return createColumnHelper<TableFeatures, T>();
}

export type Columns<T extends RowData> = ColumnDef<TableFeatures, T, any>[];

interface DataTableProps<T extends RowData> {
  columns: Columns<T>;
  data: T[];
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?(row: T): void;
  rowClassName?(row: T): string | undefined;
  getRowId?(row: T): string;
  className?: string;
}

export function DataTable<T extends RowData>({ columns, data, loading, empty, onRowClick, rowClassName, getRowId, className }: DataTableProps<T>) {
  const table = useTable<TableFeatures, T>({
    features: tableFeatureSet,
    columns,
    data,
    ...(getRowId ? { getRowId: (row: T) => getRowId(row) } : {}),
  }) as any;

  return (
    <div className={cn('relative overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          {table.getHeaderGroups().map((group: any) => (
            <tr key={group.id} className="border-b border-border">
              {group.headers.map((header: any) => (
                <th
                  key={header.id}
                  scope="col"
                  className={cn('px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted', header.column.columnDef.meta?.align === 'right' && 'text-right', header.column.columnDef.meta?.className)}
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 5 }, (_, index) => (
                <tr key={index} className="border-b border-border/60">
                  {columns.map((_, cell) => (
                    <td key={cell} className="px-4 py-3">
                      <Skeleton className="h-4 w-full max-w-40" />
                    </td>
                  ))}
                </tr>
              ))
            : table.getRowModel().rows.map((row: any) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-border/60 transition-colors last:border-0',
                    onRowClick && 'cursor-pointer hover:bg-surface-2 focus-visible:bg-surface-2',
                    rowClassName?.(row.original),
                  )}
                  {...(onRowClick
                    ? {
                        tabIndex: 0,
                        onClick: () => onRowClick(row.original),
                        onKeyDown: (event: React.KeyboardEvent) => {
                          if (event.key === 'Enter') onRowClick(row.original);
                        },
                      }
                    : {})}
                >
                  {row.getAllCells().map((cell: any) => (
                    <td key={cell.id} className={cn('px-4 py-2.5 align-middle', cell.column.columnDef.meta?.align === 'right' && 'num text-right whitespace-nowrap', cell.column.columnDef.meta?.className)}>
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && data.length === 0 && empty}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange(page: number): void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-sm text-muted">
      <span className="num">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Página anterior">
          <ChevronLeft />
        </Button>
        <span className="num px-1">
          {page} / {pages}
        </span>
        <Button variant="ghost" size="icon-sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)} aria-label="Próxima página">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
