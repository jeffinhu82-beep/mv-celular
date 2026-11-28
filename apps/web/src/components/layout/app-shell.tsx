import { useQuery } from '@tanstack/react-query';
import { KeyRound, LogOut, Menu, Search, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/misc.tsx';
import { api } from '@/lib/api.ts';
import { useAuth, useUser } from '@/lib/auth.tsx';
import type { StoreSettings } from '@/lib/types.ts';
import { cn, storeInitial } from '@/lib/utils.ts';
import { NAV_ITEMS } from '@/nav.ts';
import { CashStatus } from './cash-status.tsx';
import { GlobalSearch } from './global-search.tsx';

export function useStoreSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.get<StoreSettings>('/api/settings'), staleTime: 5 * 60_000 });
}

function Brand() {
  const settings = useStoreSettings();
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      {settings.data?.logoUrl ? (
        <img src={settings.data.logoUrl} alt="" className="size-8 rounded-md object-contain" />
      ) : (
        <div className="flex size-8 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-sm font-bold text-primary-text" aria-hidden>
          {storeInitial(settings.data?.name)}
        </div>
      )}
      <span className="truncate text-sm font-semibold">{settings.data?.name ?? 'Loja'}</span>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { canAny } = useAuth();
  const items = NAV_ITEMS.filter((item) => item.ready && (!item.anyOf || canAny(item.anyOf)));
  return (
    <nav aria-label="Menu principal" className="flex flex-col gap-0.5 px-2">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-primary/10 text-primary-text' : 'text-muted hover:bg-surface-2 hover:text-text',
            )
          }
        >
          <item.icon className="size-4.5 shrink-0" aria-hidden />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function UserMenu() {
  const user = useUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const initials = user.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2" aria-label={`Menu do usuário ${user.name}`}>
          <span className="flex size-8 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold">{initials}</span>
          <span className="hidden text-left md:block">
            <span className="block text-sm leading-tight font-medium">{user.name}</span>
            <span className="block text-xs leading-tight text-muted">{user.roleName}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          {user.name} · {user.email ?? user.login}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/trocar-senha')}>
          <KeyRound /> Trocar senha
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState(false);
  const location = useLocation();
  const wide = location.pathname === '/os' || location.pathname.startsWith('/os/');

  useEffect(() => setDrawer(false), [location.pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full">
      <a href="#conteudo" className="sr-only z-50 rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Pular para o conteúdo
      </a>
      <aside className="no-print hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <Brand />
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <NavList />
        </div>
      </aside>

      <DialogPrimitive.Root open={drawer} onOpenChange={setDrawer}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="animate-fade-in fixed inset-0 z-50 bg-black/60 lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface pt-[env(safe-area-inset-top)] focus:outline-none lg:hidden" aria-describedby={undefined}>
            <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Fechar menu">
                  <X />
                </Button>
              </DialogPrimitive.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-6">
              <NavList onNavigate={() => setDrawer(false)} />
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur sm:px-4">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menu" onClick={() => setDrawer(true)}>
            <Menu />
          </Button>
          <button
            type="button"
            onClick={() => setSearch(true)}
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-muted transition-colors hover:border-border-strong sm:max-w-md"
          >
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="truncate">Buscar cliente, OS ou venda</span>
            <kbd className="ml-auto hidden rounded border border-border px-1.5 text-[11px] sm:inline">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <CashStatus />
            <UserMenu />
          </div>
        </header>
        <main id="conteudo" className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn('mx-auto w-full px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6', wide ? 'max-w-none' : 'max-w-7xl')}>{children}</div>
        </main>
      </div>
      <GlobalSearch open={search} onOpenChange={setSearch} />
    </div>
  );
}
