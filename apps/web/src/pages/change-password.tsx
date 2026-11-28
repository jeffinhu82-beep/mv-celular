import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema, type SessionUser } from '@loja/shared';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router';
import { z } from 'zod';
import { Button } from '@/components/ui/button.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { FullScreenLoader } from '@/components/layout/loader.tsx';
import { api, ApiError, errorMessage } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';
import { useToast } from '@/lib/toast.tsx';

const schema = z
  .object({ currentPassword: z.string().min(1, 'Informe a senha atual'), newPassword: passwordSchema, confirm: z.string() })
  .refine((value) => value.newPassword === value.confirm, { path: ['confirm'], message: 'As senhas não conferem' });

export function ChangePasswordPage() {
  const { user, loading, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });

  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;

  const submit = form.handleSubmit(async (values) => {
    try {
      const response = await api.post<{ user: SessionUser }>('/api/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      setUser(response.user);
      toast.success('Senha alterada');
      navigate('/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_PASSWORD') form.setError('currentPassword', { message: error.message });
      else form.setError('root', { message: errorMessage(error) });
    }
  });

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold">{user.mustChangePassword ? 'Crie sua senha' : 'Trocar senha'}</h1>
        <p className="mt-1 mb-5 text-sm text-muted">
          {user.mustChangePassword ? 'Por segurança, troque a senha temporária antes de começar.' : 'A nova senha precisa ter pelo menos 8 caracteres.'}
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-md border border-border bg-surface p-5" noValidate>
          {form.formState.errors.root && (
            <p role="alert" className="text-sm text-warning">
              {form.formState.errors.root.message}
            </p>
          )}
          <Field label={user.mustChangePassword ? 'Senha temporária' : 'Senha atual'} error={form.formState.errors.currentPassword?.message}>
            <Input type="password" autoComplete="current-password" autoFocus {...form.register('currentPassword')} />
          </Field>
          <Field label="Nova senha" error={form.formState.errors.newPassword?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('newPassword')} />
          </Field>
          <Field label="Repita a nova senha" error={form.formState.errors.confirm?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting}>
            Salvar senha
          </Button>
          {user.mustChangePassword ? (
            <Button variant="ghost" onClick={() => logout().then(() => navigate('/login', { replace: true }))}>
              Sair
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Voltar
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
