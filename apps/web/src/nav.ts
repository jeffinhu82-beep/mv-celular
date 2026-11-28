import type { PermissionKey } from '@loja/shared';
import {
  BarChart3,
  ClipboardList,
  History,
  Home,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
  UserSquare2,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  anyOf?: PermissionKey[];
  ready: boolean;
  mobile?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Início', icon: Home, ready: true, mobile: true },
  { to: '/caixa', label: 'Caixa', icon: Wallet, anyOf: ['cash.open_close', 'cash.income', 'cash.withdrawal_expense', 'finance.view'], ready: true },
  { to: '/vender', label: 'Vender', icon: ShoppingCart, anyOf: ['sale.create'], ready: true, mobile: true },
  { to: '/vendas', label: 'Histórico', icon: History, anyOf: ['sale.create', 'sale.view_all'], ready: true },
  { to: '/os', label: 'Ordens de serviço', icon: ClipboardList, anyOf: ['os.edit', 'os.move', 'os.view_all', 'os.quote_edit'], ready: true, mobile: true },
  { to: '/clientes', label: 'Clientes', icon: UserSquare2, ready: true, mobile: true },
  { to: '/produtos', label: 'Produtos e estoque', icon: Package, ready: true },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3, anyOf: ['report.view'], ready: true },
  { to: '/equipe', label: 'Equipe', icon: Users, anyOf: ['team.manage'], ready: true },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, anyOf: ['settings.manage'], ready: true },
  { to: '/auditoria', label: 'Auditoria', icon: ShieldCheck, anyOf: ['audit.view'], ready: true },
];
