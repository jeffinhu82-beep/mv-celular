import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api.ts';
import type { CashSessionView } from '@/lib/types.ts';

export interface CashStatusResponse {
  session: { id: string; openedAt: string; openedByName: string } | null;
}

export function useCashStatus() {
  return useQuery({ queryKey: ['cash', 'status'], queryFn: () => api.get<CashStatusResponse>('/api/cash/status'), refetchInterval: 60_000 });
}

export function useCurrentCash(enabled = true) {
  return useQuery({ queryKey: ['cash', 'current'], queryFn: () => api.get<{ session: CashSessionView | null }>('/api/cash/current'), enabled });
}

export function invalidateMoney(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['cash'] }),
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    queryClient.invalidateQueries({ queryKey: ['sales'] }),
    queryClient.invalidateQueries({ queryKey: ['sale'] }),
    queryClient.invalidateQueries({ queryKey: ['quotes'] }),
    queryClient.invalidateQueries({ queryKey: ['products'] }),
  ]);
}
