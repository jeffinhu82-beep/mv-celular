import { AlarmClock, ChevronRight, Hourglass } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Card, CardHeader } from '@/components/ui/misc.tsx';
import { useAuth } from '@/lib/auth.tsx';
import { cn, plural } from '@/lib/utils.ts';
import { NAV_ITEMS } from '@/nav.ts';

export function useCanOpen() {
  const { canAny } = useAuth();
  return (path: string) => {
    const item = NAV_ITEMS.find((entry) => entry.to === path);
    if (!item?.ready) return false;
    return !item.anyOf?.length || canAny(item.anyOf);
  };
}

export function MaybeLink({ to, enabled, className, children }: { to: string; enabled: boolean; className?: string; children: ReactNode }) {
  if (!enabled) return <div className={className}>{children}</div>;
  return (
    <Link to={to} className={cn('transition-colors hover:bg-surface-2 focus-visible:bg-surface-2', className)}>
      {children}
    </Link>
  );
}

export function ListCard({ title, description, action, children, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader title={title} description={description} actions={action} />
      <div className="flex-1">{children}</div>
    </Card>
  );
}

export function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-0.5 rounded-sm text-xs font-medium text-muted transition-colors hover:text-text focus-visible:text-text">
      {children}
      <ChevronRight className="size-3.5" aria-hidden />
    </Link>
  );
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

export function StageDot({ color }: { color: string }) {
  return <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />;
}

export function OsCounters({ staleCount, lateCount, staleDays }: { staleCount: number; lateCount: number; staleDays?: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
          lateCount > 0 ? 'border-primary/30 bg-primary/10 text-primary-text' : 'border-border text-muted',
        )}
      >
        <AlarmClock className="size-3.5" aria-hidden />
        {plural(lateCount, 'atrasada', 'atrasadas')}
      </span>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
          staleCount > 0 ? 'border-warning/30 bg-warning/10 text-warning' : 'border-border text-muted',
        )}
        title={staleDays ? `Sem mudar de etapa há mais de ${staleDays} dias` : undefined}
      >
        <Hourglass className="size-3.5" aria-hidden />
        {plural(staleCount, 'parada', 'paradas')}
      </span>
    </div>
  );
}
