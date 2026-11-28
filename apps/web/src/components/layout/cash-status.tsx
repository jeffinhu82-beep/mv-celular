import { firstName, formatTime } from '@loja/shared';
import { Link } from 'react-router';
import { useCashStatus } from '@/features/cash/queries.ts';
import { useAuth } from '@/lib/auth.tsx';
import { cn } from '@/lib/utils.ts';

export function CashStatus() {
  const { canAny } = useAuth();
  const status = useCashStatus();
  if (!status.data) return null;
  const session = status.data.session;
  const label = session ? `Aberto por ${firstName(session.openedByName)} desde ${formatTime(session.openedAt)}` : 'Caixa fechado';
  const content = (
    <>
      <span className={cn('size-2 rounded-full', session ? 'bg-success' : 'bg-muted')} aria-hidden />
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{session ? 'Aberto' : 'Fechado'}</span>
    </>
  );
  const className = cn(
    'inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium whitespace-nowrap',
    session ? 'border-success/30 bg-success/10 text-success' : 'border-border text-muted',
  );
  if (canAny(['cash.open_close', 'cash.income', 'cash.withdrawal_expense', 'finance.view'])) {
    return (
      <Link to="/caixa" className={cn(className, 'hover:bg-surface-2')} title={label} aria-label={label}>
        {content}
      </Link>
    );
  }
  return (
    <span className={className} title={label} aria-label={label}>
      {content}
    </span>
  );
}
