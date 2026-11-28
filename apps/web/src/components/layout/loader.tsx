import { Loader2 } from 'lucide-react';

export function FullScreenLoader() {
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-label="Carregando">
      <Loader2 className="size-6 animate-spin text-muted" />
    </div>
  );
}

export function SectionLoader() {
  return (
    <div className="flex items-center justify-center py-16" role="status" aria-label="Carregando">
      <Loader2 className="size-5 animate-spin text-muted" />
    </div>
  );
}
