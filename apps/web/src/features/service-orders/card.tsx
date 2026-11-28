import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatMoney, formatRelativeDays } from '@loja/shared';
import { ArrowRightLeft, ExternalLink, HandCoins, MessageCircle, MoreHorizontal } from 'lucide-react';
import type { CSSProperties, KeyboardEvent, ReactNode, Ref, SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/misc.tsx';
import type { BoardColumn, ServiceOrderCard } from '@/lib/types.ts';
import { cn } from '@/lib/utils.ts';
import { StageDot } from '@/features/dashboard/shared.tsx';
import { BalanceBadge, deviceLabel, FlagBadges, TechAvatar } from './shared.tsx';

export interface CardActions {
  open(card: ServiceOrderCard): void;
  whatsapp(card: ServiceOrderCard, column: BoardColumn): void;
  deliver(card: ServiceOrderCard): void;
  moveTo(card: ServiceOrderCard, column: BoardColumn): void;
}

export interface CardContext {
  column: BoardColumn;
  columns: BoardColumn[];
  now: Date;
  staleDays: number;
  canMove: boolean;
  canDeliver: boolean;
  actions: CardActions;
}

const stop = (event: SyntheticEvent) => event.stopPropagation();

export function SortableCard({ card, context: base }: { card: ServiceOrderCard; context: CardContext }) {
  const context = { ...base, column: base.columns.find((column) => column.id === card.columnId) ?? base.column };
  const editable = context.canMove && !['done', 'cancelled'].includes(context.column.stageType);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, data: { type: 'card' }, disabled: !editable });
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      context.actions.open(card);
      return;
    }
    listeners?.onKeyDown?.(event);
  };
  return (
    <OsCardView
      ref={setNodeRef}
      card={card}
      context={context}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && 'opacity-40')}
      dragProps={{ ...attributes, ...listeners, onKeyDown, role: 'group', 'aria-roledescription': editable ? 'card arrastável' : 'card' }}
    />
  );
}

export function OsCardView({
  card,
  context,
  overlay,
  className,
  style,
  dragProps,
  ref,
}: {
  card: ServiceOrderCard;
  context: CardContext;
  overlay?: boolean;
  className?: string;
  style?: CSSProperties;
  dragProps?: Record<string, unknown>;
  ref?: Ref<HTMLElement>;
}) {
  const { column, actions } = context;
  const closed = ['done', 'cancelled'].includes(column.stageType);
  const ready = column.stageType === 'ready' && !card.sale;
  const showWhatsapp = column.whatsappEnabled && Boolean(card.customer.phoneE164);
  const targets = context.columns.filter((entry) => entry.id !== column.id && entry.stageType !== 'done');
  const label = `${card.number}, ${card.customer.name}, ${deviceLabel(card)}`;

  return (
    <article
      ref={ref}
      style={style}
      tabIndex={0}
      aria-label={label}
      onClick={() => actions.open(card)}
      {...dragProps}
      className={cn(
        'group relative flex cursor-pointer touch-manipulation flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3 text-left text-sm shadow-sm transition-[border-color,box-shadow] outline-none select-none',
        'hover:border-surface-3 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary/60',
        overlay && 'rotate-[1.5deg] cursor-grabbing border-primary/40 shadow-2xl shadow-black/60',
        closed && 'opacity-80',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="num text-xs font-medium text-muted">{card.number}</p>
          <p className="truncate font-semibold">{card.customer.name}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1" onPointerDown={stop} onKeyDown={stop} onClick={stop}>
          <TechAvatar name={card.technicianName} />
          {!overlay && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Ações da ${card.number}`} className="size-7 text-muted">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuItem onSelect={() => actions.open(card)}>
                  <ExternalLink /> Abrir detalhe
                </DropdownMenuItem>
                {showWhatsapp && (
                  <DropdownMenuItem onSelect={() => actions.whatsapp(card, column)}>
                    <MessageCircle /> WhatsApp
                  </DropdownMenuItem>
                )}
                {ready && context.canDeliver && (
                  <DropdownMenuItem onSelect={() => actions.deliver(card)}>
                    <HandCoins /> Receber e entregar
                  </DropdownMenuItem>
                )}
                {context.canMove && !closed && targets.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="flex items-center gap-1.5">
                      <ArrowRightLeft className="size-3.5" /> Mover para…
                    </DropdownMenuLabel>
                    {targets.map((target) => (
                      <DropdownMenuItem key={target.id} onSelect={() => actions.moveTo(card, target)}>
                        <StageDot color={target.color} /> {target.name}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="min-w-0">
        <p className="truncate text-[13px]">{deviceLabel(card)}</p>
        <p className="truncate text-xs text-muted" title={card.reportedIssue}>
          {card.reportedIssue}
        </p>
      </div>

      <FlagRow>
        <FlagBadges flags={card.flags} />
      </FlagRow>

      <div className="flex items-center justify-between gap-2">
        <span className="num text-[13px] font-semibold">{card.totalCents > 0 ? formatMoney(card.totalCents) : <span className="font-normal text-muted">Sem orçamento</span>}</span>
        <BalanceBadge totalCents={card.totalCents} balanceCents={card.balanceCents} paidCents={card.paidCents} />
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span title="Tempo nesta coluna">{closed && card.closedAt ? formatRelativeDays(card.closedAt, context.now) : formatRelativeDays(card.columnEnteredAt, context.now)}</span>
        {(showWhatsapp || (ready && context.canDeliver)) && !overlay && (
          <div className="flex items-center gap-1" onPointerDown={stop} onKeyDown={stop} onClick={stop}>
            {showWhatsapp && (
              <Button variant="ghost" size="icon-sm" className="size-7 text-success" aria-label={`WhatsApp para ${card.customer.name}`} onClick={() => actions.whatsapp(card, column)}>
                <MessageCircle />
              </Button>
            )}
            {ready && context.canDeliver && (
              <Button size="sm" variant="primary" className="h-7 px-2 text-xs" onClick={() => actions.deliver(card)}>
                <HandCoins /> Receber e entregar
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function FlagRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1 empty:hidden">{children}</div>;
}
