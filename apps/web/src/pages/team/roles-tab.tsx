import { PERMISSIONS, type PermissionKey } from '@loja/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { SectionLoader } from '@/components/layout/loader.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/controls.tsx';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input, NativeSelect } from '@/components/ui/input.tsx';
import { PercentInput } from '@/components/ui/masked.tsx';
import { Badge, Card, Tooltip } from '@/components/ui/misc.tsx';
import { api, errorMessage } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';
import type { Role } from '@/lib/types.ts';
import { useToast } from '@/lib/toast.tsx';
import { useRoles } from './users-tab.tsx';

interface Draft {
  name: string;
  discountLimitBps: number;
  permissions: PermissionKey[];
}

const GROUPS = PERMISSIONS.reduce<{ group: string; items: (typeof PERMISSIONS)[number][] }[]>((acc, permission) => {
  const last = acc.at(-1);
  if (last && last.group === permission.group) last.items.push(permission);
  else acc.push({ group: permission.group, items: [permission] });
  return acc;
}, []);

function toDraft(role: Role): Draft {
  return { name: role.name, discountLimitBps: role.discountLimitBps, permissions: [...role.permissions] };
}

function sameDraft(a: Draft, b: Draft) {
  return a.name === b.name && a.discountLimitBps === b.discountLimitBps && a.permissions.length === b.permissions.length && a.permissions.every((key) => b.permissions.includes(key));
}

function NewRoleDialog({ open, onOpenChange, roles }: { open: boolean; onOpenChange(open: boolean): void; roles: Role[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [baseId, setBaseId] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) {
      setName('');
      setBaseId('');
      setError(undefined);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () => {
      const base = roles.find((role) => role.id === baseId);
      return api.post('/api/roles', { name, discountLimitBps: base?.discountLimitBps ?? 0, permissions: base?.permissions ?? [] });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Perfil criado', 'Marque as permissões e salve.');
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Novo perfil"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" form="role-form" loading={create.isPending}>
              Criar
            </Button>
          </>
        }
      >
        <form
          id="role-form"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return setError('Nome do perfil é obrigatório');
            create.mutate();
          }}
        >
          <Field label="Nome" required error={error}>
            <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Vendedor" />
          </Field>
          <Field label="Copiar permissões de" hint="Opcional">
            <NativeSelect value={baseId} onChange={(event) => setBaseId(event.target.value)}>
              <option value="">Nenhum (começar vazio)</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RolesTab() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const roles = useRoles();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Role | null>(null);
  const list = useMemo(() => roles.data ?? [], [roles.data]);

  useEffect(() => {
    setDrafts(Object.fromEntries(list.map((role) => [role.id, toDraft(role)])));
  }, [list]);

  const changed = list.filter((role) => drafts[role.id] && !sameDraft(drafts[role.id]!, toDraft(role)));

  const save = useMutation({
    mutationFn: async () => {
      for (const role of changed) await api.put(`/api/roles/${role.id}`, drafts[role.id]);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      if (user && changed.some((role) => role.id === user.roleId)) {
        const me = await api.get<{ user: typeof user }>('/api/auth/me');
        setUser(me.user);
      }
      toast.success('Permissões salvas', 'Valem a partir da próxima ação de cada usuário.');
    },
    onError: async (err) => {
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.error('Não foi possível salvar', errorMessage(err));
    },
  });

  const remove = useMutation({
    mutationFn: (role: Role) => api.delete(`/api/roles/${role.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Perfil excluído');
      setRemoving(null);
    },
    onError: (err) => {
      setRemoving(null);
      toast.error('Não foi possível excluir', errorMessage(err));
    },
  });

  const update = (roleId: string, patch: Partial<Draft>) => setDrafts((current) => ({ ...current, [roleId]: { ...current[roleId]!, ...patch } }));

  const togglePermission = (roleId: string, key: PermissionKey, checked: boolean) => {
    const draft = drafts[roleId];
    if (!draft) return;
    update(roleId, { permissions: checked ? [...draft.permissions, key] : draft.permissions.filter((item) => item !== key) });
  };

  if (roles.isPending) return <SectionLoader />;

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
          <p className="text-sm text-muted">Toda permissão é conferida no servidor. O Administrador sempre tem acesso total.</p>
          <div className="flex gap-2">
            {changed.length > 0 && (
              <Button variant="ghost" onClick={() => setDrafts(Object.fromEntries(list.map((role) => [role.id, toDraft(role)])))}>
                <Undo2 /> Descartar
              </Button>
            )}
            <Button variant="secondary" onClick={() => setCreating(true)}>
              <Plus /> Novo perfil
            </Button>
            <Button variant="primary" disabled={changed.length === 0} loading={save.isPending} onClick={() => save.mutate()}>
              <Save /> Salvar{changed.length > 0 ? ` (${changed.length})` : ''}
            </Button>
          </div>
        </div>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="sticky left-0 z-10 bg-surface px-4 py-3 text-left font-medium text-muted">
                  Permissão
                </th>
                {list.map((role) => {
                  const draft = drafts[role.id];
                  const locked = role.slug === 'admin';
                  return (
                    <th key={role.id} scope="col" className="min-w-36 px-3 py-3 text-center align-top font-medium">
                      {locked || role.system ? (
                        <span className="inline-flex items-center gap-1">
                          {locked && <ShieldCheck className="size-4 text-success" aria-hidden />}
                          {role.name}
                        </span>
                      ) : (
                        <div className="flex items-center justify-center gap-1">
                          <Input
                            aria-label={`Nome do perfil ${role.name}`}
                            className="h-8 w-28 text-center"
                            value={draft?.name ?? role.name}
                            onChange={(event) => update(role.id, { name: event.target.value })}
                          />
                          <Tooltip content={role.userCount > 0 ? 'Mova os usuários antes de excluir' : 'Excluir perfil'}>
                            <span>
                              <Button variant="ghost" size="icon-sm" aria-label={`Excluir perfil ${role.name}`} disabled={role.userCount > 0} onClick={() => setRemoving(role)}>
                                <Trash2 />
                              </Button>
                            </span>
                          </Tooltip>
                        </div>
                      )}
                      <p className="mt-1 text-xs font-normal text-muted">
                        {role.userCount} {role.userCount === 1 ? 'usuário' : 'usuários'}
                      </p>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border bg-surface-2/50">
                <th scope="row" className="sticky left-0 z-10 bg-surface-2 px-4 py-3 text-left font-normal">
                  <span className="font-medium">Limite de desconto</span>
                  <p className="text-xs text-muted">Acima disso, o PDV pede aprovação de quem tem a permissão.</p>
                </th>
                {list.map((role) => (
                  <td key={role.id} className="px-3 py-2 text-center">
                    <PercentInput
                      aria-label={`Limite de desconto de ${role.name}`}
                      className="mx-auto w-24"
                      inputClassName="h-8"
                      value={drafts[role.id]?.discountLimitBps ?? role.discountLimitBps}
                      onValueChange={(bps) => update(role.id, { discountLimitBps: Math.min(bps, 10000) })}
                    />
                  </td>
                ))}
              </tr>
              {GROUPS.map((group) => (
                <Fragment key={group.group}>
                  <tr>
                    <th colSpan={list.length + 1} scope="colgroup" className="sticky left-0 bg-surface px-4 pt-5 pb-2 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                      {group.group}
                    </th>
                  </tr>
                  {group.items.map((permission) => (
                    <tr key={permission.key} className="border-b border-border/60 hover:bg-surface-2/40">
                      <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-normal">
                        {permission.label}
                      </th>
                      {list.map((role) => {
                        const locked = role.slug === 'admin';
                        const checked = locked || Boolean(drafts[role.id]?.permissions.includes(permission.key));
                        return (
                          <td key={role.id} className="px-3 py-2 text-center">
                            <Checkbox
                              aria-label={`${permission.label} — ${role.name}`}
                              checked={checked}
                              disabled={locked}
                              onCheckedChange={(value) => togglePermission(role.id, permission.key, value === true)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {changed.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-border p-3">
            <Badge tone="warning">Alterações não salvas em {changed.map((role) => role.name).join(', ')}</Badge>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              <Save /> Salvar
            </Button>
          </div>
        )}
      </Card>
      <NewRoleDialog open={creating} onOpenChange={setCreating} roles={list} />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Excluir o perfil ${removing?.name ?? ''}?`}
        description="O perfil não tem usuários. Essa ação fica registrada na auditoria."
        confirmLabel="Excluir"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing);
        }}
      />
    </>
  );
}
