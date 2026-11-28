import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateMoney } from '@/features/cash/queries.ts';
import { api } from '@/lib/api.ts';
import type { BoardResponse, ServiceOrderDetail } from '@/lib/types.ts';
import { toQuery } from '@/lib/utils.ts';

export interface BoardFilters {
  technicianId: string;
  q: string;
  late: boolean;
  stale: boolean;
  period: string;
  from: string;
  to: string;
  all: boolean;
}

export function boardQueryParams(filters: BoardFilters): Record<string, string | undefined> {
  return {
    technicianId: filters.technicianId || undefined,
    q: filters.q || undefined,
    late: filters.late ? '1' : undefined,
    stale: filters.stale ? '1' : undefined,
    period: filters.period || undefined,
    from: filters.period === 'range' ? filters.from : undefined,
    to: filters.period === 'range' ? filters.to : undefined,
    all: filters.all ? '1' : undefined,
  };
}

export function useBoard(filters: BoardFilters) {
  const params = boardQueryParams(filters);
  return useQuery({
    queryKey: ['service-orders', 'board', params],
    queryFn: () => api.get<BoardResponse>(`/api/service-orders/board${toQuery(params)}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useServiceOrder(id: string | null | undefined) {
  return useQuery({
    queryKey: ['service-order', id],
    queryFn: () => api.get<ServiceOrderDetail>(`/api/service-orders/${id}`),
    enabled: Boolean(id),
  });
}

export function useRefreshServiceOrders() {
  const queryClient = useQueryClient();
  return (detail?: ServiceOrderDetail) => {
    if (detail) {
      const { moved: _moved, delivery: _delivery, ...rest } = detail;
      queryClient.setQueryData(['service-order', detail.id], rest);
    }
    void queryClient.invalidateQueries({ queryKey: ['service-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['receivables'] });
    void queryClient.invalidateQueries({ queryKey: ['customer'] });
    void invalidateMoney(queryClient);
  };
}
