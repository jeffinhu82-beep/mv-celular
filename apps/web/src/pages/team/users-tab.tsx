import { formatDateTime } from '@loja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, MoreHorizontal, Pencil, Plus, Power, RefreshCw, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { columnHelper, DataTable } from '@/components/ui/data-table.tsx';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input, NativeSelect } from '@/components/ui/input.tsx';
import { Badge, Card, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState } from '@/components/ui/misc.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import { useUser } from '@/lib/auth.tsx';
import type { Role, TeamUser } from '@/lib/types.ts';
import { useToast } from '@/lib/toast.tsx';

const col = columnHelper<TeamUser>();

export function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/api/roles') });
}

function statusBadge(user: TeamUser) {
  if (!user.active) return <Badge tone="muted">Inativo</Badge>;
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) return <Badge tone="warning">Bloqueado</Badge>;
  if (user.mustChangePassword) return <Badge tone="info">Aguardando 1º acesso</Badge>;
  return <Badge tone="success">Ativo</Badge>;
}

function UserFormDialog({ user, onOpenChange }: { user: TeamUser | null | undefined; onOpenChange(open: boolean): void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const roles = useRoles();
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const open = user !== undefined;

  useEffect(() => {
    if (!open) return;
    setName(user?.name ?? '');
    setLogin(user?.login ?? '');
    setEmail(user?.email ?? '');
    setRoleId(user?.roleId ?? roles.data?.find((role) => role.slug === 'cashier')?.id ?? '');
    setPassword(user ? '' : generatePassword());
    setErrors({});
  }, [open, user, roles.data]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (user) await api.put(`/api/users/${user.id}`, { name, email, roleId });
      else await api.post('/api/users', { name, email, login, roleId, temporaryPassword: password });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success(user ? 'Usuário atualizado' : 'Usuário criado', user ? name : `Entra com ${email.trim().toLowerCase()} e a senha temporária ${password}`);
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
        title={user ? 'Editar usuário' : 'Novo usuário'}
        description={user ? undefined : 'A pessoa troca a senha temporária no primeiro acesso.'}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" form="user-form" loading={saving}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="user-form" onSubmit={submit} className="grid gap-4" noValidate>
          <Field label="Nome" required error={errors.name}>
            <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="E-mail" required error={errors.email} hint="É com ele que a pessoa entra no sistema">
            <Input type="email" inputMode="email" value={email} autoCapitalize="none" autoComplete="off" onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Usuário" required error={errors.login} hint={user ? 'Também serve para entrar; não pode ser alterado' : 'Também serve para entrar. Letras minúsculas, números, ponto ou hífen'}>
            <Input value={login} disabled={Boolean(user)} autoCapitalize="none" autoComplete="off" onChange={(event) => setLogin(event.target.value.toLowerCase())} />
          </Field>
          <Field label="Perfil" required error={errors.roleId}>
            <NativeSelect value={roleId} onChange={(event) => setRoleId(event.target.value)}>
              <option value="" disabled>
                Escolha
              </option>
              {roles.data?.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {!user && (
            <Field label="Senha temporária" required error={errors.temporaryPassword} hint="Anote e entregue para a pessoa">
              <div className="flex gap-2">
                <Input className="num flex-1" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" />
                <Button variant="secondary" size="icon" aria-label="Gerar outra senha" onClick={() => setPassword(generatePassword())}>
                  <RefreshCw />
                </Button>
              </div>
            </Field>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onOpenChange }: { user: TeamUser | null; onOpenChange(open: boolean): void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (user) {
      setPassword(generatePassword());
      setDone(false);
    }
  }, [user]);

  const reset = useMutation({
    mutationFn: () => api.post(`/api/users/${user!.id}/reset-password`, { temporaryPassword: password }),
    onSuccess: async () => {
      setDone(true);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => toast.error('Não foi possível redefinir', errorMessage(error)),
  });

  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent
        title={done ? 'Senha redefinida' : `Redefinir senha de ${user?.name ?? ''}`}
        description={done ? 'A pessoa foi desconectada e vai criar uma senha nova no próximo acesso.' : 'A senha atual deixa de valer e todas as sessões são encerradas.'}
        size="sm"
        footer={
          done ? (
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              Pronto
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button variant="primary" loading={reset.isPending} onClick={() => reset.mutate()} disabled={password.length < 8}>
                Redefinir
              </Button>
            </>
          )
        }
      >
        <Field label="Senha temporária" hint={done ? `Entra com ${user?.email ?? user?.login}` : 'Mínimo de 8 caracteres'}>
          <div className="flex gap-2">
            <Input className="num flex-1" value={password} readOnly={done} onChange={(event) => setPassword(event.target.value)} autoComplete="off" />
            {done ? (
              <Button
                variant="secondary"
                size="icon"
                aria-label="Copiar senha"
                onClick={() => navigator.clipboard?.writeText(password).then(() => toast.success('Senha copiada'))}
              >
                <Copy />
              </Button>
            ) : (
              <Button variant="secondary" size="icon" aria-label="Gerar outra senha" onClick={() => setPassword(generatePassword())}>
                <RefreshCw />
              </Button>
            )}
          </div>
        </Field>
      </DialogContent>
    </Dialog>
  );
}

export function UsersTab() {
  const me = useUser();
  const toast = useToast();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<TeamUser[]>('/api/users') });
  const [editing, setEditing] = useState<TeamUser | null | undefined>(undefined);
  const [resetting, setResetting] = useState<TeamUser | null>(null);
  const [toggling, setToggling] = useState<TeamUser | null>(null);

  const toggle = useMutation({
    mutationFn: (user: TeamUser) => api.put(`/api/users/${user.id}`, { active: !user.active }),
    onSuccess: async (_, user) => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(user.active ? 'Usuário desativado' : 'Usuário reativado', user.name);
      setToggling(null);
    },
    onError: (error) => {
      setToggling(null);
      toast.error('Não foi possível alterar', errorMessage(error));
    },
  });

  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: 'Nome',
        cell: (info) => (
          <div>
            <p className="font-medium">
              {info.getValue()} {info.row.original.id === me.id && <span className="text-xs font-normal text-muted">(você)</span>}
            </p>
            <p className="text-xs break-all text-muted">{info.row.original.email ?? info.row.original.login}</p>
            <p className="text-xs text-muted sm:hidden">{info.row.original.role.name}</p>
          </div>
        ),
      }),
      col.accessor((row) => row.role.name, { id: 'role', header: 'Perfil', meta: { className: 'hidden sm:table-cell' } }),
      col.accessor('lastLoginAt', { header: 'Último acesso', meta: { className: 'hidden md:table-cell' }, cell: (info) => <span className="num text-muted">{info.getValue() ? formatDateTime(info.getValue()!) : 'nunca'}</span> }),
      col.display({ id: 'status', header: 'Situação', cell: (info) => statusBadge(info.row.original) }),
      col.display({
        id: 'actions',
        header: () => <span className="sr-only">Ações</span>,
        meta: { align: 'right' },
        cell: (info) => {
          const user = info.row.original;
          return (
            <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Ações de ${user.name}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => setEditing(user)}>
                    <Pencil /> Editar
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setResetting(user)}>
                    <KeyRound /> Redefinir senha
                  </DropdownMenuItem>
                  {user.id !== me.id && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setToggling(user)} className={user.active ? 'text-primary-text' : undefined}>
                        <Power /> {user.active ? 'Desativar' : 'Reativar'}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      }),
    ],
    [me.id],
  );

  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <p className="text-sm text-muted">Usuários nunca são excluídos: desative quem saiu da equipe para manter o histórico.</p>
          <Button variant="primary" onClick={() => setEditing(null)}>
            <Plus /> Novo usuário
          </Button>
        </div>
        <DataTable
          columns={columns}
          data={users.data ?? []}
          loading={users.isPending}
          getRowId={(row) => row.id}
          onRowClick={(row) => setEditing(row)}
          rowClassName={(row) => (row.active ? undefined : 'opacity-60')}
          empty={<EmptyState icon={Users} title="Nenhum usuário" />}
        />
      </Card>
      <UserFormDialog user={editing} onOpenChange={(open) => !open && setEditing(undefined)} />
      <ResetPasswordDialog user={resetting} onOpenChange={(open) => !open && setResetting(null)} />
      <ConfirmDialog
        open={Boolean(toggling)}
        onOpenChange={(open) => !open && setToggling(null)}
        title={toggling?.active ? `Desativar ${toggling.name}?` : `Reativar ${toggling?.name ?? ''}?`}
        description={toggling?.active ? 'A pessoa é desconectada e não consegue mais entrar. Vendas e OS dela continuam no histórico.' : 'A pessoa volta a conseguir entrar com a senha atual.'}
        confirmLabel={toggling?.active ? 'Desativar' : 'Reativar'}
        destructive={Boolean(toggling?.active)}
        loading={toggle.isPending}
        onConfirm={() => {
          if (toggling) toggle.mutate(toggling);
        }}
      />
    </>
  );
}
