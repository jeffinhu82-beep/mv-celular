import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from './utils.ts';

type Tone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  success(title: string, description?: string, action?: ToastItem['action']): void;
  error(title: string, description?: string): void;
  info(title: string, description?: string, action?: ToastItem['action']): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);

  const push = useCallback(
    (tone: Tone, title: string, description?: string, action?: ToastItem['action']) => {
      const id = nextId.current++;
      setItems((current) => [...current.slice(-3), { id, tone, title, ...(description ? { description } : {}), ...(action ? { action } : {}) }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4500);
    },
    [dismiss],
  );

  const value = useMemo<ToastApi>(
    () => ({
      success: (title, description, action) => push('success', title, description, action),
      error: (title, description) => push('error', title, description),
      info: (title, description, action) => push('info', title, description, action),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end" aria-live="polite" role="status">
        {items.map((item) => {
          const Icon = item.tone === 'success' ? CheckCircle2 : item.tone === 'error' ? TriangleAlert : Info;
          return (
            <div
              key={item.id}
              className="animate-fade-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border border-border bg-surface-2 p-3 shadow-lg shadow-black/40"
            >
              <Icon
                className={cn('mt-0.5 size-4 shrink-0', item.tone === 'success' && 'text-success', item.tone === 'error' && 'text-warning', item.tone === 'info' && 'text-info')}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.title}</p>
                {item.description && <p className="mt-0.5 text-sm text-muted">{item.description}</p>}
                {item.action && (
                  <button
                    type="button"
                    className="mt-1.5 text-sm font-medium text-primary-text hover:underline"
                    onClick={() => {
                      item.action?.onClick();
                      dismiss(item.id);
                    }}
                  >
                    {item.action.label}
                  </button>
                )}
              </div>
              <button type="button" onClick={() => dismiss(item.id)} className="rounded p-0.5 text-muted hover:text-text" aria-label="Fechar aviso">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast fora do ToastProvider');
  return context;
}
