import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api.ts';
import type { FeeSettings } from '@/lib/types.ts';

export function useFeeConfig() {
  return useQuery({ queryKey: ['settings', 'fees'], queryFn: () => api.get<FeeSettings>('/api/settings/fees'), staleTime: 5 * 60_000 });
}
