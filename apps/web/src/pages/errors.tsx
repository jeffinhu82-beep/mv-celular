import { Lock, RefreshCw, SearchX, TriangleAlert } from 'lucide-react';
import { Link, useRouteError } from 'react-router';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/misc.tsx';

export function ForbiddenPage() {
  return (
    <EmptyState
      className="py-24"
      icon={Lock}
      title="Você não tem acesso a esta tela"
      description="Peça para o administrador liberar a permissão no seu perfil."
      action={
        <Button asChild variant="secondary">
          <Link to="/">Voltar ao início</Link>
        </Button>
      }
    />
  );
}

export function NotFoundPage() {
  return (
    <EmptyState
      className="py-24"
      icon={SearchX}
      title="Página não encontrada"
      description="O endereço pode ter mudado ou o registro não existe mais."
      action={
        <Button asChild variant="secondary">
          <Link to="/">Voltar ao início</Link>
        </Button>
      }
    />
  );
}

function isStaleChunk(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(message);
}

export function RouteErrorPage() {
  const error = useRouteError();
  const stale = isStaleChunk(error);
  return (
    <EmptyState
      className="py-24"
      icon={TriangleAlert}
      title={stale ? 'O sistema foi atualizado' : 'Esta tela não abriu'}
      description={stale ? 'Recarregue a página para usar a versão nova. Nada do que já foi salvo se perde.' : 'Recarregue a página. Se continuar, volte ao início e tente de novo.'}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>
            <RefreshCw /> Recarregar
          </Button>
          {!stale && (
            <Button asChild variant="secondary">
              <Link to="/">Voltar ao início</Link>
            </Button>
          )}
        </div>
      }
    />
  );
}
