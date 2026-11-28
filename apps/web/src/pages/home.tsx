import { firstName } from '@loja/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { RefreshCw, ShoppingCart } from 'lucide-react';
import { Link } from 'react-router';
import { PeriodPicker, periodQuery, readPeriod } from '@/components/filters/period-picker.tsx';
import { SectionLoader } from '@/components/layout/loader.tsx';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState, PageHeader } from '@/components/ui/misc.tsx';
import { FullDashboard } from '@/features/dashboard/full.tsx';
import { ReducedDashboard } from '@/features/dashboard/reduced.tsx';
import { api, errorMessage } from '@/lib/api.ts';
import { useAuth, useUser } from '@/lib/auth.tsx';
import { useSearchState } from '@/lib/hooks.ts';
import type { Dashboard } from '@/lib/types.ts';
import { cn, toQuery } from '@/lib/utils.ts';

export function HomePage() {
  const user = useUser();
  const { can, canAny } = useAuth();
  const [params, update] = useSearchState();
  const showFinance = can('finance.view');
  const sells = can('sale.create');
  const handlesOrders = canAny(['os.edit', 'os.move', 'os.view_all', 'os.quote_edit']);
  const period = readPeriod(params, 'today');
  const query = showFinance ? periodQuery(period) : {};
  const dashboard = useQuery({
    queryKey: ['dashboard', query],
    queryFn: () => api.get<Dashboard>(`/api/dashboard${toQuery(query)}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const data = dashboard.data;

  return (
    <>
      <PageHeader
        title={`Olá, ${firstName(user.name)}`}
        description={showFinance || sells || handlesOrders ? undefined : 'Bem-vindo ao sistema.'}
        actions={
          showFinance ? (
            <PeriodPicker value={period} onChange={(next) => update({ period: next.kind === 'today' ? null : next.kind, from: next.from ?? null, to: next.to ?? null })} />
          ) : sells ? (
            <Button asChild>
              <Link to="/vender">
                <ShoppingCart className="size-4" /> Nova venda
              </Link>
            </Button>
          ) : undefined
        }
      />
      {!data && dashboard.isPending && <SectionLoader />}
      {!data && dashboard.isError && (
        <EmptyState
          title="Não foi possível carregar o resumo"
          description={errorMessage(dashboard.error)}
          action={
            <Button variant="outline" onClick={() => dashboard.refetch()}>
              <RefreshCw className="size-4" /> Tentar de novo
            </Button>
          }
        />
      )}
      {data && (
        <div className={cn('transition-opacity', dashboard.isPlaceholderData && 'opacity-60')} aria-busy={dashboard.isPlaceholderData}>
          {data.mode === 'full' ? <FullDashboard data={data} /> : <ReducedDashboard data={data} />}
        </div>
      )}
    </>
  );
}
