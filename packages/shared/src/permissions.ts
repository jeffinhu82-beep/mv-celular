export const PERMISSIONS = [
  { key: 'finance.view', group: 'Financeiro', label: 'Ver resumo financeiro completo (resultado, taxas, custos)' },
  { key: 'product.cost.view', group: 'Financeiro', label: 'Ver custo e margem dos produtos' },
  { key: 'cash.open_close', group: 'Caixa', label: 'Abrir e fechar caixa' },
  { key: 'cash.income', group: 'Caixa', label: 'Registrar entrada avulsa e suprimento' },
  { key: 'cash.withdrawal_expense', group: 'Caixa', label: 'Registrar sangria e custos' },
  { key: 'cash.reopen', group: 'Caixa', label: 'Reabrir caixa fechado' },
  { key: 'sale.create', group: 'Vendas', label: 'Vender e receber OS' },
  { key: 'sale.price_override', group: 'Vendas', label: 'Alterar preço no PDV' },
  { key: 'sale.discount_over_limit', group: 'Vendas', label: 'Desconto acima do limite do perfil' },
  { key: 'sale.allow_pending', group: 'Vendas', label: 'Entregar OS ou vender com saldo pendente' },
  { key: 'sale.cancel', group: 'Vendas', label: 'Cancelar venda' },
  { key: 'sale.view_all', group: 'Vendas', label: 'Ver histórico de todas as vendas (senão, só as próprias)' },
  { key: 'os.edit', group: 'Ordens de serviço', label: 'Criar e editar OS' },
  { key: 'os.view_all', group: 'Ordens de serviço', label: 'Ver todas as OS (senão, só as atribuídas e sem técnico)' },
  { key: 'os.move', group: 'Ordens de serviço', label: 'Mover OS no Kanban' },
  { key: 'os.quote_edit', group: 'Ordens de serviço', label: 'Editar orçamento da OS' },
  { key: 'os.unlock_secret.view', group: 'Ordens de serviço', label: 'Ver senha de desbloqueio do aparelho' },
  { key: 'product.manage', group: 'Cadastros', label: 'Cadastrar e editar produtos e preços' },
  { key: 'stock.manage', group: 'Cadastros', label: 'Entrada e ajuste de estoque' },
  { key: 'customer.manage', group: 'Cadastros', label: 'Criar e editar clientes' },
  { key: 'customer.privacy', group: 'Cadastros', label: 'Exportar e anonimizar dados de cliente (LGPD)' },
  { key: 'report.view', group: 'Gestão', label: 'Ver relatórios' },
  { key: 'team.manage', group: 'Gestão', label: 'Gerenciar equipe e perfis' },
  { key: 'settings.manage', group: 'Gestão', label: 'Configurações (loja, taxas, Kanban, impressão)' },
  { key: 'audit.view', group: 'Gestão', label: 'Ver log de auditoria' },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS = PERMISSIONS.map((permission) => permission.key) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as string[]).includes(value);
}

const ALL = PERMISSION_KEYS;

export const DEFAULT_ROLES: {
  slug: string;
  name: string;
  discountLimitBps: number;
  permissions: PermissionKey[];
}[] = [
  { slug: 'admin', name: 'Administrador', discountLimitBps: 10000, permissions: [...ALL] },
  {
    slug: 'cashier',
    name: 'Caixa/Atendente',
    discountLimitBps: 500,
    permissions: ['cash.open_close', 'cash.income', 'sale.create', 'os.edit', 'os.view_all', 'os.move', 'customer.manage'],
  },
  {
    slug: 'technician',
    name: 'Técnico',
    discountLimitBps: 0,
    permissions: ['os.edit', 'os.move', 'os.quote_edit', 'os.unlock_secret.view', 'customer.manage'],
  },
];

export interface SessionUser {
  id: string;
  name: string;
  login: string;
  email: string | null;
  roleId: string;
  roleName: string;
  discountLimitBps: number;
  permissions: PermissionKey[];
  mustChangePassword: boolean;
}

export function can(user: Pick<SessionUser, 'permissions'> | null | undefined, key: PermissionKey): boolean {
  return Boolean(user?.permissions.includes(key));
}
