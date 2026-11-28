import { PERMISSIONS } from '@loja/shared';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { setApprovalHandler, type ApprovalCredentials } from './api.ts';

interface Pending {
  permission: string;
  message: string;
  error?: string;
  resolve(value: ApprovalCredentials | null): void;
}

export function ApprovalProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const loginRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setApprovalHandler(
      (request) =>
        new Promise((resolve) => {
          setPassword('');
          setPending({ ...request, resolve });
        }),
    );
    return () => setApprovalHandler(null);
  }, []);

  const close = (value: ApprovalCredentials | null) => {
    pending?.resolve(value);
    setPending(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!login.trim() || !password) return;
    close({ login: login.trim(), password });
  };

  const label = PERMISSIONS.find((permission) => permission.key === pending?.permission)?.label;

  return (
    <>
      {children}
      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && close(null)}>
        <DialogContent
          size="sm"
          title={
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary-text" aria-hidden /> Autorização necessária
            </span>
          }
          description={pending?.message}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            loginRef.current?.focus();
          }}
        >
          <form id="approval-form" onSubmit={submit} className="flex flex-col gap-4">
            {label && <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-muted">Permissão necessária: {label}</p>}
            {pending?.error && (
              <p role="alert" className="text-sm text-warning">
                {pending.error}
              </p>
            )}
            <Field label="E-mail ou usuário de quem autoriza">
              <Input ref={loginRef} value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="off" autoCapitalize="none" />
            </Field>
            <Field label="Senha">
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => close(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={!login.trim() || !password}>
                Autorizar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
