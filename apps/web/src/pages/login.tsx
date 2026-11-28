import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type SessionUser } from '@loja/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { Button } from '@/components/ui/button.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { api, errorMessage } from '@/lib/api.ts';
import { useAuth } from '@/lib/auth.tsx';

type LoginForm = z.input<typeof loginSchema>;

export function LoginPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const store = useQuery({ queryKey: ['public-store'], queryFn: () => api.get<{ name: string; logoUrl: string | null }>('/api/public/store'), staleTime: Infinity });
  const form = useForm<LoginForm>({ resolver: zodResolver(loginSchema), defaultValues: { login: '', password: '' } });

  if (user) return <Navigate to={user.mustChangePassword ? '/trocar-senha' : '/'} replace />;

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const response = await api.post<{ user: SessionUser }>('/api/auth/login', values);
      setUser(response.user);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(response.user.mustChangePassword ? '/trocar-senha' : from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      form.setValue('password', '');
      form.setFocus('password');
    }
  });

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {store.data?.logoUrl ? (
            <img src={store.data.logoUrl} alt="" className="size-14 rounded-md object-contain" />
          ) : (
            <img src="/icon.svg" alt="" className="size-14" />
          )}
          <div>
            <h1 className="text-xl font-semibold">{store.data?.name ?? 'Loja e Assistência'}</h1>
            <p className="mt-1 text-sm text-muted">Entre com seu e-mail e senha.</p>
          </div>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-md border border-border bg-surface p-5" noValidate>
          {error && (
            <p role="alert" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              {error}
            </p>
          )}
          <Field label="E-mail ou usuário" error={form.formState.errors.login?.message}>
            <Input type="text" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus {...form.register('login')} />
          </Field>
          <Field label="Senha" error={form.formState.errors.password?.message}>
            <Input type="password" autoComplete="current-password" {...form.register('password')} />
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting}>
            Entrar
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted">Esqueceu a senha? Peça ao administrador para redefinir.</p>
      </div>
    </div>
  );
}
