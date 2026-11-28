import { formatDate, formatMoney, formatTime } from '@loja/shared';
import { Badge } from '@/components/ui/misc.tsx';
import { useStoreSettings } from '@/components/layout/app-shell.tsx';
import { SaleStatusBadge } from '@/features/sales/shared.tsx';
import { useAuth } from '@/lib/auth.tsx';
import type { DashboardReduced } from '@/lib/types.ts';
import { plural } from '@/lib/utils.ts';
import { CardLink, EmptyLine, ListCard, MaybeLink, OsCounters, StageDot, useCanOpen } from './shared.tsx';

export function ReducedDashboard({ data }: { data: DashboardReduced }) {
  const { can, canAny } = useAuth();
  const sells = can('sale.create');
  const handlesOrders = canAny(['os.edit', 'os.move', 'os.view_all', 'os.quote_edit']);
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      {sells && <MySalesCard sales={data.mySales} />}
      {handlesOrders && <MyOrdersCard orders={data.myOrders} className={sells ? undefined : 'lg:col-span-2'} />}
    </div>
  );
}

function MySalesCard({ sales }: { sales: DashboardReduced['mySales'] }) {
  const canOpen = useCanOpen();
  const clickable = canOpen('/vendas');
  return (
    <ListCard
      title="Suas vendas de hoje"
      description={sales.count > 0 ? plural(sales.count, 'venda', 'vendas') : undefined}
      action={<span className="num text-lg font-semibold tracking-tight">{formatMoney(sales.totalCents)}</span>}
    >
      {sales.items.length === 0 ? (
        <EmptyLine>Nenhuma venda hoje ainda.</EmptyLine>
      ) : (
        <ul className="divide-y divide-border">
          {sales.items.map((sale) => (
            <li key={sale.id}>
              <MaybeLink to={`/vendas/${sale.id}`} enabled={clickable} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="num w-12 shrink-0 text-muted">{formatTime(sale.completedAt)}</span>
                <div className="min-w-0 flex-1">
                  <p className="num font-medium">{sale.number}</p>
                  <p className="truncate text-xs text-muted">{sale.customerName ?? 'Consumidor'}</p>
                </div>
                {sale.status !== 'completed' && <SaleStatusBadge status={sale.status} />}
                <span className="num font-medium">{formatMoney(sale.totalCents)}</span>
              </MaybeLink>
            </li>
          ))}
        </ul>
      )}
    </ListCard>
  );
}

function MyOrdersCard({ orders, className }: { orders: DashboardReduced['myOrders']; className?: string }) {
  const canOpen = useCanOpen();
  const settings = useStoreSettings();
  const clickable = canOpen('/os');
  return (
    <ListCard
      title="Suas ordens de serviço"
      description="Com você como técnico ou que você recebeu"
      action={clickable ? <CardLink to="/os">Abrir quadro</CardLink> : undefined}
      className={className}
    >
      <div className="px-4 pt-3">
        <OsCounters staleCount={orders.staleCount} lateCount={orders.lateCount} staleDays={settings.data?.staleOsDays} />
      </div>
      {orders.items.length === 0 ? (
        <EmptyLine>Nenhuma OS aberta com você.</EmptyLine>
      ) : (
        <ul className="mt-2 divide-y divide-border border-t border-border">
          {orders.items.map((order) => (
            <li key={order.id}>
              <MaybeLink to={`/os/${order.id}`} enabled={clickable} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="num font-medium">{order.number}</span>
                    <span className="truncate">{order.device}</span>
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                    <StageDot color={order.columnColor} />
                    {order.columnName} · {order.customerName}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {order.late && <Badge tone="primary">Atrasada</Badge>}
                  {!order.late && order.stale && <Badge tone="warning">Parada</Badge>}
                  {order.dueAt && <span className="num text-xs text-muted">Prazo {formatDate(order.dueAt)}</span>}
                </div>
              </MaybeLink>
            </li>
          ))}
        </ul>
      )}
    </ListCard>
  );
}
