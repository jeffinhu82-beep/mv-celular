import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { formatMoney } from '@loja/shared';
import { useEffect, useMemo, useState } from 'react';
import type { BoardColumn, ServiceOrderCard } from '@/lib/types.ts';
import { cn, plural } from '@/lib/utils.ts';
import { OsCardView, SortableCard, type CardActions, type CardContext } from './card.tsx';

type Containers = Record<string, string[]>;

export interface KanbanProps {
  columns: BoardColumn[];
  now: Date;
  staleDays: number;
  canMove: boolean;
  canDeliver: boolean;
  actions: CardActions;
  onDrop(card: ServiceOrderCard, target: BoardColumn, afterId: string | null): Promise<void>;
  onShowAll(): void;
}

function toContainers(columns: BoardColumn[]): Containers {
  return Object.fromEntries(columns.map((column) => [column.id, column.cards.map((card) => card.id)]));
}

const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const hits = within.length > 0 ? within : rectIntersection(args);
  const cardIds = new Set(hits.filter((hit) => hit.data?.droppableContainer?.data.current?.type === 'card').map((hit) => hit.id));
  if (cardIds.size === 0) return hits;
  return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((container) => cardIds.has(container.id)) });
};

export function Kanban({ columns, now, staleDays, canMove, canDeliver, actions, onDrop, onShowAll }: KanbanProps) {
  const [containers, setContainers] = useState<Containers>(() => toContainers(columns));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(0);

  useEffect(() => {
    if (!activeId && busy === 0) setContainers(toContainers(columns));
  }, [columns, activeId, busy]);

  const cards = useMemo(() => new Map(columns.flatMap((column) => column.cards.map((card) => [card.id, card] as const))), [columns]);
  const columnById = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }),
  );

  const containerOf = (id: UniqueIdentifier, state = containers): string | undefined => {
    const key = String(id);
    if (key in state) return key;
    return Object.keys(state).find((columnId) => state[columnId]!.includes(key));
  };

  const nameOf = (id: UniqueIdentifier | undefined) => (id === undefined ? '' : (columnById.get(containerOf(id) ?? '')?.name ?? ''));
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Pegou ${cards.get(String(active.id))?.number ?? 'a OS'}, na coluna ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${cards.get(String(active.id))?.number ?? 'OS'} sobre a coluna ${nameOf(over.id)}.` : 'Fora das colunas.'),
    onDragEnd: ({ active, over }) => (over ? `${cards.get(String(active.id))?.number ?? 'OS'} solta em ${nameOf(over.id)}.` : 'Movimento cancelado.'),
    onDragCancel: ({ active }) => `Movimento de ${cards.get(String(active.id))?.number ?? 'OS'} cancelado.`,
  };

  const onDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id));

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setContainers((state) => {
      const from = containerOf(active.id, state);
      const to = containerOf(over.id, state);
      if (!from || !to || from === to) return state;
      const target = state[to]!;
      const overIndex = target.indexOf(String(over.id));
      const translated = active.rect.current.translated;
      const below = overIndex >= 0 && translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
      const index = overIndex >= 0 ? overIndex + (below ? 1 : 0) : target.length;
      return {
        ...state,
        [from]: state[from]!.filter((id) => id !== active.id),
        [to]: [...target.slice(0, index), String(active.id), ...target.slice(index)],
      };
    });
  };

  const reset = () => {
    setActiveId(null);
    setContainers(toContainers(columns));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const card = cards.get(String(active.id));
    const from = containerOf(active.id);
    const to = over ? containerOf(over.id) : undefined;
    if (!card || !from || !to || !over) return reset();
    let ordered = containers[to]!;
    if (from === to) {
      const oldIndex = ordered.indexOf(card.id);
      const newIndex = String(over.id) in containers ? ordered.length - 1 : ordered.indexOf(String(over.id));
      if (newIndex >= 0 && oldIndex !== newIndex) ordered = arrayMove(ordered, oldIndex, newIndex);
    }
    const index = ordered.indexOf(card.id);
    const original = columnById.get(card.columnId)?.cards.map((entry) => entry.id) ?? [];
    setActiveId(null);
    if (to === card.columnId && original.indexOf(card.id) === index) return reset();
    const target = columnById.get(to);
    if (!target) return reset();
    setContainers((state) => ({ ...state, [to]: ordered }));
    setBusy((count) => count + 1);
    void onDrop(card, target, index > 0 ? (ordered[index - 1] ?? null) : null).finally(() => setBusy((count) => count - 1));
  };

  const active = activeId ? cards.get(activeId) : undefined;
  const activeColumn = active ? columnById.get(active.columnId) : undefined;

  const contextFor = (column: BoardColumn): CardContext => ({ column, columns, now, staleDays, canMove, canDeliver, actions });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: 'Para mover a OS, pressione espaço. Use as setas para trocar de posição ou de coluna e espaço de novo para soltar. Esc cancela. Enter abre o detalhe.' },
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
    >
      <div className="relative -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:snap-none sm:scroll-px-6 sm:px-6">
        {columns.map((column) => (
          <KanbanColumnView
            key={column.id}
            column={column}
            ids={containers[column.id] ?? []}
            cards={cards}
            context={contextFor(column)}
            onShowAll={onShowAll}
            highlight={Boolean(activeId) && containerOf(activeId!) === column.id && column.id !== active?.columnId}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
        {active && activeColumn ? <OsCardView card={active} context={contextFor(activeColumn)} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumnView({
  column,
  ids,
  cards,
  context,
  onShowAll,
  highlight,
}: {
  column: BoardColumn;
  ids: string[];
  cards: Map<string, ServiceOrderCard>;
  context: CardContext;
  onShowAll(): void;
  highlight: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: column.id, data: { type: 'column' } });
  return (
    <section
      aria-label={`${column.name}, ${plural(column.count, 'OS', 'OS')}`}
      className={cn(
        'flex max-h-[calc(100dvh-15rem)] min-h-48 w-[85vw] shrink-0 snap-start flex-col rounded-xl border border-border bg-surface transition-colors sm:w-72',
        highlight && 'border-primary/40 bg-primary/5',
      )}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: column.color }} aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={column.name}>
          {column.name}
        </h2>
        <span className="num rounded-md bg-surface-3 px-1.5 py-0.5 text-xs font-medium text-muted">{column.count}</span>
      </header>
      {(column.sumCents !== null || column.limited) && (
        <div className="flex items-center justify-between gap-2 px-3 pt-2 text-xs text-muted">
          {column.sumCents !== null ? <span className="num">{formatMoney(column.sumCents)}</span> : <span />}
          {column.limited && (
            <button type="button" onClick={onShowAll} className="text-primary-text hover:underline">
              Últimos 30 dias · ver todas
            </button>
          )}
        </div>
      )}
      <SortableContext id={column.id} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {ids.map((id) => {
            const card = cards.get(id);
            return card ? <SortableCard key={id} card={card} context={context} /> : null;
          })}
          {ids.length === 0 && <p className="m-auto px-2 py-6 text-center text-xs text-muted">Nenhuma OS aqui</p>}
        </div>
      </SortableContext>
    </section>
  );
}
