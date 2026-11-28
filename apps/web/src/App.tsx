import type { PermissionKey } from '@loja/shared';
import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppShell } from './components/layout/app-shell.tsx';
import { FullScreenLoader, SectionLoader } from './components/layout/loader.tsx';
import { TooltipProvider } from './components/ui/misc.tsx';
import { ApprovalProvider } from './lib/approval.tsx';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { ToastProvider } from './lib/toast.tsx';
import { NAV_ITEMS } from './nav.ts';
import { ChangePasswordPage } from './pages/change-password.tsx';
import { ForbiddenPage, NotFoundPage, RouteErrorPage } from './pages/errors.tsx';
import { LoginPage } from './pages/login.tsx';

function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}

const HomePage = page(() => import('./pages/home.tsx'), 'HomePage');
const CashPage = page(() => import('./pages/cash/index.tsx'), 'CashPage');
const PosPage = page(() => import('./pages/sales/pos.tsx'), 'PosPage');
const SalesHistoryPage = page(() => import('./pages/sales/history.tsx'), 'SalesHistoryPage');
const SaleDetailPage = page(() => import('./pages/sales/detail.tsx'), 'SaleDetailPage');
const ServiceOrdersPage = page(() => import('./pages/service-orders/board.tsx'), 'ServiceOrdersPage');
const CustomersPage = page(() => import('./pages/customers/list.tsx'), 'CustomersPage');
const CustomerDetailPage = page(() => import('./pages/customers/detail.tsx'), 'CustomerDetailPage');
const ProductsPage = page(() => import('./pages/products/index.tsx'), 'ProductsPage');
const ReportsPage = page(() => import('./pages/reports/index.tsx'), 'ReportsPage');
const TeamPage = page(() => import('./pages/team/index.tsx'), 'TeamPage');
const SettingsPage = page(() => import('./pages/settings/index.tsx'), 'SettingsPage');
const AuditPage = page(() => import('./pages/audit/index.tsx'), 'AuditPage');

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: window.location.pathname + window.location.search }} />;
  if (user.mustChangePassword) return <Navigate to="/trocar-senha" replace />;
  return (
    <AppShell>
      <Suspense fallback={<SectionLoader />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}

function Guard({ path, children }: { path: string; children: React.ReactNode }) {
  const { canAny } = useAuth();
  const item = NAV_ITEMS.find((entry) => entry.to === path);
  const keys = item?.anyOf as PermissionKey[] | undefined;
  if (keys && keys.length > 0 && !canAny(keys)) return <ForbiddenPage />;
  return <>{children}</>;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/trocar-senha', element: <ChangePasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'caixa', element: <Guard path="/caixa"><CashPage /></Guard> },
          { path: 'vender', element: <Guard path="/vender"><PosPage /></Guard> },
          { path: 'vendas', element: <Guard path="/vendas"><SalesHistoryPage /></Guard> },
          { path: 'vendas/:id', element: <Guard path="/vendas"><SaleDetailPage /></Guard> },
          { path: 'os', element: <Guard path="/os"><ServiceOrdersPage /></Guard> },
          { path: 'os/:id', element: <Guard path="/os"><ServiceOrdersPage /></Guard> },
          { path: 'clientes', element: <Guard path="/clientes"><CustomersPage /></Guard> },
          { path: 'clientes/:id', element: <Guard path="/clientes"><CustomerDetailPage /></Guard> },
          { path: 'produtos', element: <Guard path="/produtos"><ProductsPage /></Guard> },
          { path: 'relatorios', element: <Guard path="/relatorios"><ReportsPage /></Guard> },
          { path: 'equipe', element: <Guard path="/equipe"><TeamPage /></Guard> },
          { path: 'configuracoes', element: <Guard path="/configuracoes"><SettingsPage /></Guard> },
          { path: 'auditoria', element: <Guard path="/auditoria"><AuditPage /></Guard> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <ApprovalProvider>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
        </ApprovalProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
