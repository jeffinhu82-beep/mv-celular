import { formatMoney } from '@loja/shared';
import { cn } from '@/lib/utils.ts';

export function DifferenceValue({ cents }: { cents: number | null }) {
  if (cents === null) return <span className="text-muted">—</span>;
  return <span className={cn('num font-medium', cents === 0 ? 'text-success' : 'text-warning')}>{cents === 0 ? 'Sem diferença' : formatMoney(cents)}</span>;
}
