import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Card, EmptyState } from '@/components/ui/misc.tsx';
import { SectionLoader } from '@/components/layout/loader.tsx';
import { useCategories } from '@/features/products/product-form.tsx';
import { api, errorMessage } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';
import type { Category } from '@/lib/types.ts';
import { useToast } from '@/lib/toast.tsx';

export function CategoriesTab() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [editing, setEditing] = useState<Category | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [removing, setRemoving] = useState<Category | null>(null);
  const canManage = can('product.manage');

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['categories'] }), queryClient.invalidateQueries({ queryKey: ['products'] })]);

  const save = useMutation({
    mutationFn: () => (editing ? api.put(`/api/categories/${editing.id}`, { name }) : api.post('/api/categories', { name })),
    onSuccess: async () => {
      await refresh();
      toast.success(editing ? 'Categoria renomeada' : 'Categoria criada', name);
      setEditing(undefined);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (category: Category) => api.delete(`/api/categories/${category.id}`),
    onSuccess: async () => {
      await refresh();
      toast.success('Categoria excluída');
      setRemoving(null);
    },
    onError: (err) => {
      setRemoving(null);
      toast.error('Não foi possível excluir', errorMessage(err));
    },
  });

  const open = (category: Category | null) => {
    setEditing(category);
    setName(category?.name ?? '');
    setError(undefined);
  };

  if (categories.isPending) return <SectionLoader />;
  const list = categories.data ?? [];

  return (
    <>
      <Card>
        <div className="flex items-center justify-between border-b border-border p-3">
          <p className="text-sm text-muted">{list.length} categorias</p>
          {canManage && (
            <Button variant="primary" onClick={() => open(null)}>
              <Plus /> Nova categoria
            </Button>
          )}
        </div>
        {list.length === 0 ? (
          <EmptyState icon={Tags} title="Nenhuma categoria" description="Categorias ajudam a filtrar produtos e ver relatórios por grupo (ex.: Películas, Capas, Peças)." />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((category) => (
              <li key={category.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{category.name}</p>
                  <p className="text-xs text-muted">{category._count?.products ?? 0} itens</p>
                </div>
                {canManage && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon-sm" aria-label={`Renomear ${category.name}`} onClick={() => open(category)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${category.name}`} onClick={() => setRemoving(category)}>
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog open={editing !== undefined} onOpenChange={(value) => !value && setEditing(undefined)}>
        <DialogContent
          title={editing ? 'Renomear categoria' : 'Nova categoria'}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(undefined)}>
                Cancelar
              </Button>
              <Button variant="primary" type="submit" form="category-form" loading={save.isPending}>
                Salvar
              </Button>
            </>
          }
        >
          <form
            id="category-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return setError('Nome é obrigatório');
              save.mutate();
            }}
          >
            <Field label="Nome" required error={error}>
              <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(value) => !value && setRemoving(null)}
        title={`Excluir a categoria ${removing?.name ?? ''}?`}
        description="Só é possível excluir categorias sem produtos."
        confirmLabel="Excluir"
        destructive
        loading={remove.isPending}
        onConfirm={() => { if (removing) remove.mutate(removing); }}
      />
    </>
  );
}
