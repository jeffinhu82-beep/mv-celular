import { closestCenter, DndContext, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { REQUIRED_FIELD_OPTIONS, renderTemplate, SAMPLE_TEMPLATE_VALUES, STAGE_TYPE_LABELS, STAGE_TYPES, TEMPLATE_VARIABLES, type StageType } from '@loja/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, GripVertical, MessageCircle, Pencil, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useStoreSettings } from '@/components/layout/app-shell.tsx';
import { SectionLoader } from '@/components/layout/loader.tsx';
import { Button } from '@/components/ui/button.tsx';
import { CheckboxField, SwitchField } from '@/components/ui/controls.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input, NativeSelect, Textarea } from '@/components/ui/input.tsx';
import { Badge, Card } from '@/components/ui/misc.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import type { KanbanColumn } from '@/lib/types.ts';
import { useToast } from '@/lib/toast.tsx';
import { cn } from '@/lib/utils.ts';

const COLOR_PRESETS = ['#79AEE0', '#A99AE6', '#F0A83C', '#EC8A4C', '#4CC38A', '#2F9D6B', '#E93737', '#E27BA8', '#8C8381'];

const STAGE_HINTS: Record<StageType, string> = {
  entry: 'OS recém-chegadas',
  in_progress: 'Em diagnóstico, aguardando peça, em conserto…',
  ready: 'Pronto para retirada; aqui aparece "Receber e entregar"',
  done: 'Entregue. Mostra só os últimos 30 dias',
  cancelled: 'Cancelada ou devolvida sem conserto. Últimos 30 dias',
};

interface ColumnForm {
  name: string;
  color: string;
  stageType: StageType;
  requiredFields: string[];
  whatsappEnabled: boolean;
  whatsappTrigger: 'on_move' | 'manual';
  templateBody: string;
  archived: boolean;
}

const EMPTY: ColumnForm = {
  name: '',
  color: COLOR_PRESETS[0]!,
  stageType: 'in_progress',
  requiredFields: [],
  whatsappEnabled: false,
  whatsappTrigger: 'manual',
  templateBody: '',
  archived: false,
};

function ColumnDialog({ column, onOpenChange }: { column: KanbanColumn | null | undefined; onOpenChange(open: boolean): void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const store = useStoreSettings();
  const templateRef = useRef<HTMLTextAreaElement>(null);
  const [form, setForm] = useState<ColumnForm>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const open = column !== undefined;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      column
        ? {
            name: column.name,
            color: column.color,
            stageType: column.stageType,
            requiredFields: column.requiredFields,
            whatsappEnabled: column.whatsappEnabled,
            whatsappTrigger: column.whatsappTrigger,
            templateBody: column.template?.body ?? '',
            archived: column.archived,
          }
        : EMPTY,
    );
  }, [open, column]);

  const insertVariable = (key: string) => {
    const token = `{${key}}`;
    const element = templateRef.current;
    const start = element?.selectionStart ?? form.templateBody.length;
    const end = element?.selectionEnd ?? form.templateBody.length;
    const body = form.templateBody.slice(0, start) + token + form.templateBody.slice(end);
    setForm({ ...form, templateBody: body });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const preview = renderTemplate(form.templateBody, {
    ...SAMPLE_TEMPLATE_VALUES,
    loja: store.data?.name ?? SAMPLE_TEMPLATE_VALUES.loja,
    endereco_loja: store.data?.address ?? SAMPLE_TEMPLATE_VALUES.endereco_loja,
    garantia_dias: String(store.data?.warrantyDays ?? 90),
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.whatsappEnabled && !form.templateBody.trim()) {
      setErrors({ templateBody: 'Escreva a mensagem ou desligue o WhatsApp nesta coluna' });
      return;
    }
    setSaving(true);
    try {
      if (column) await api.put(`/api/kanban/columns/${column.id}`, form);
      else await api.post('/api/kanban/columns', form);
      await queryClient.invalidateQueries({ queryKey: ['kanban-columns'] });
      toast.success(column ? 'Coluna atualizada' : 'Coluna criada', form.name);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION') setErrors(error.fieldErrors());
      else toast.error('Não foi possível salvar', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={column ? `Coluna ${column.name}` : 'Nova coluna'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" form="column-form" loading={saving}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="column-form" onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Field label="Nome" required error={errors.name}>
              <Input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <Field label="Cor" error={errors.color}>
              <div className="flex items-center gap-1.5">
                {COLOR_PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Cor ${color}`}
                    aria-pressed={form.color.toLowerCase() === color.toLowerCase()}
                    onClick={() => setForm({ ...form, color })}
                    className={cn('size-7 rounded-full border-2', form.color.toLowerCase() === color.toLowerCase() ? 'border-text' : 'border-transparent')}
                    style={{ backgroundColor: color }}
                  />
                ))}
                <input type="color" aria-label="Outra cor" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} className="size-7 cursor-pointer rounded border-0 bg-transparent p-0" />
              </div>
            </Field>
          </div>
          <Field label="Etapa" hint={STAGE_HINTS[form.stageType]} error={errors.stageType}>
            <NativeSelect value={form.stageType} onChange={(event) => setForm({ ...form, stageType: event.target.value as StageType })}>
              {STAGE_TYPES.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_TYPE_LABELS[stage]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Para entrar nesta coluna, a OS precisa ter</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {REQUIRED_FIELD_OPTIONS.map((option) => (
                <CheckboxField
                  key={option.key}
                  label={option.label}
                  checked={form.requiredFields.includes(option.key)}
                  onCheckedChange={(checked) =>
                    setForm({
                      ...form,
                      requiredFields: checked === true ? [...form.requiredFields, option.key] : form.requiredFields.filter((key) => key !== option.key),
                    })
                  }
                />
              ))}
            </div>
          </fieldset>
          <SwitchField
            label="Mensagem de WhatsApp"
            description="Abre o WhatsApp com a mensagem pronta para o cliente. Nada é enviado sem você confirmar."
            checked={form.whatsappEnabled}
            onCheckedChange={(checked) => setForm({ ...form, whatsappEnabled: checked })}
          />
          {form.whatsappEnabled && (
            <div className="grid gap-4 rounded-lg border border-border p-3">
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Quando</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ['on_move', 'Perguntar ao mover a OS para cá'],
                      ['manual', 'Só pelo botão no card'],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-sm">
                      <input type="radio" name="trigger" className="accent-primary" checked={form.whatsappTrigger === value} onChange={() => setForm({ ...form, whatsappTrigger: value })} />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label="Mensagem" error={errors.templateBody}>
                <Textarea ref={templateRef} rows={4} value={form.templateBody} onChange={(event) => setForm({ ...form, templateBody: event.target.value })} />
              </Field>
              <div className="flex flex-wrap gap-1.5" aria-label="Inserir variável">
                {TEMPLATE_VARIABLES.map((variable) => (
                  <button
                    key={variable.key}
                    type="button"
                    title={variable.label}
                    onClick={() => insertVariable(variable.key)}
                    className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted hover:border-primary hover:text-text"
                  >
                    {`{${variable.key}}`}
                  </button>
                ))}
              </div>
              {form.templateBody.trim() && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted">Prévia com dados de exemplo</p>
                  <p className="rounded-lg bg-[#144d37] px-3 py-2 text-sm whitespace-pre-wrap text-[#e9fbe9]">{preview}</p>
                </div>
              )}
            </div>
          )}
          {column && (
            <SwitchField
              label="Arquivar coluna"
              description="Some do quadro. Só dá para arquivar colunas abertas sem OS."
              checked={form.archived}
              onCheckedChange={(checked) => setForm({ ...form, archived: checked })}
            />
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SortableColumn({ column, onEdit }: { column: KanbanColumn; onEdit(): void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center gap-3 border-b border-border bg-surface px-3 py-2.5 last:border-b-0', isDragging && 'relative z-10 shadow-lg ring-1 ring-primary')}
    >
      <button type="button" className="cursor-grab touch-none rounded p-1 text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Reordenar ${column.name}`} {...attributes} {...listeners}>
        <GripVertical className="size-4" />
      </button>
      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: column.color }} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{column.name}</p>
        <p className="text-xs text-muted">
          {STAGE_TYPE_LABELS[column.stageType]}
          {column.requiredFields.length > 0 && ` · ${column.requiredFields.length} exigência(s)`}
        </p>
      </div>
      {column.whatsappEnabled && (
        <Badge tone="success">
          <MessageCircle className="size-3" /> {column.whatsappTrigger === 'on_move' ? 'ao mover' : 'manual'}
        </Badge>
      )}
      <Button variant="ghost" size="icon-sm" aria-label={`Editar ${column.name}`} onClick={onEdit}>
        <Pencil />
      </Button>
    </li>
  );
}

export function KanbanTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const columns = useQuery({
    queryKey: ['kanban-columns', 'all'],
    queryFn: () => api.get<KanbanColumn[]>('/api/kanban/columns?includeArchived=true'),
  });
  const [order, setOrder] = useState<KanbanColumn[]>([]);
  const [editing, setEditing] = useState<KanbanColumn | null | undefined>(undefined);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (columns.data) setOrder(columns.data.filter((column) => !column.archived));
  }, [columns.data]);

  if (columns.isPending) return <SectionLoader />;
  const archived = (columns.data ?? []).filter((column) => column.archived);

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const previous = order;
    const next = arrayMove(order, order.findIndex((column) => column.id === active.id), order.findIndex((column) => column.id === over.id));
    setOrder(next);
    try {
      await api.put('/api/kanban/columns-order', { ids: [...next, ...archived].map((column) => column.id) });
      await queryClient.invalidateQueries({ queryKey: ['kanban-columns'] });
    } catch (error) {
      setOrder(previous);
      toast.error('Não foi possível reordenar', errorMessage(error));
    }
  };

  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Colunas do quadro de OS</h2>
            <p className="text-sm text-muted">Arraste para mudar a ordem (ou use Espaço e as setas). Cada coluna pertence a uma etapa.</p>
          </div>
          <Button variant="primary" onClick={() => setEditing(null)}>
            <Plus /> Nova coluna
          </Button>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order.map((column) => column.id)} strategy={verticalListSortingStrategy}>
            <ul>
              {order.map((column) => (
                <SortableColumn key={column.id} column={column} onEdit={() => setEditing(column)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </Card>
      {archived.length > 0 && (
        <Card>
          <div className="border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Archive className="size-4 text-muted" /> Arquivadas
            </h2>
          </div>
          <ul>
            {archived.map((column) => (
              <li key={column.id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
                <span className="size-3 rounded-full opacity-50" style={{ backgroundColor: column.color }} aria-hidden />
                <span className="flex-1 text-sm text-muted">{column.name}</span>
                <Button variant="ghost" size="sm" onClick={() => setEditing(column)}>
                  Editar
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <ColumnDialog column={editing} onOpenChange={(open) => !open && setEditing(undefined)} />
    </>
  );
}
