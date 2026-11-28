import { APPROVAL_CHANNEL_LABELS, SALE_ORIGIN_LABELS, SALE_STATUS_LABELS, STAGE_TYPE_LABELS } from './constants.ts';
import { formatBps, formatDateTime, formatMoney } from './format.ts';
import { PAYMENT_METHOD_LABELS } from './money/fees.ts';
import { PERMISSIONS } from './permissions.ts';

export const AUDIT_ACTION_LABELS = {
  'auth.login': 'Entrou no sistema',
  'auth.login_failed': 'Errou a senha',
  'auth.locked': 'Login bloqueado por tentativas',
  'auth.password_changed': 'Trocou a própria senha',
  'user.created': 'Criou usuário',
  'user.updated': 'Editou usuário',
  'user.password_reset': 'Redefiniu senha de usuário',
  'role.created': 'Criou perfil',
  'role.deleted': 'Excluiu perfil',
  'role.permissions_changed': 'Mudou permissões de perfil',
  'role.discount_limit_changed': 'Mudou limite de desconto de perfil',
  'cash.opened': 'Abriu o caixa',
  'cash.closed': 'Fechou o caixa',
  'cash.reopened': 'Reabriu o caixa',
  'cash.withdrawal': 'Registrou sangria',
  'cash.expense': 'Registrou custo',
  'sale.completed': 'Registrou venda',
  'sale.payment_received': 'Recebeu saldo de venda',
  'sale.cancelled': 'Cancelou venda',
  'quote.cancelled': 'Cancelou orçamento de venda',
  'sale.discount_over_limit': 'Desconto acima do limite',
  'sale.price_override': 'Alterou preço no PDV',
  'quote.created': 'Criou orçamento de venda',
  'quote.converted': 'Converteu orçamento em venda',
  'os.created': 'Abriu OS',
  'os.updated': 'Editou OS',
  'os.quote_updated': 'Atualizou orçamento da OS',
  'os.approved': 'Registrou aprovação do orçamento',
  'os.rejected': 'Registrou recusa do orçamento',
  'os.discount_over_limit': 'Desconto acima do limite na OS',
  'os.deposit': 'Recebeu sinal de OS',
  'os.delivered': 'Entregou OS',
  'os.cancelled': 'Cancelou OS',
  'os.secret_viewed': 'Viu a senha do aparelho',
  'kanban.column_created': 'Criou coluna do Kanban',
  'kanban.column_updated': 'Editou coluna do Kanban',
  'product.created': 'Cadastrou produto',
  'product.updated': 'Editou produto',
  'product.price_changed': 'Alterou preço de produto',
  'product.imported': 'Importou produtos',
  'stock.purchase': 'Registrou entrada de estoque',
  'stock.adjusted': 'Ajustou estoque',
  'customer.exported': 'Exportou dados de cliente',
  'customer.anonymized': 'Anonimizou cliente',
  'settings.fees_updated': 'Alterou taxas',
  'settings.store_updated': 'Alterou dados da loja',
  'settings.print_updated': 'Alterou impressão',
  'settings.defaults_updated': 'Alterou padrões',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTION_LABELS;

export const AUDIT_GROUPS = [
  { prefix: 'auth.', label: 'Acesso' },
  { prefix: 'user.', label: 'Usuários' },
  { prefix: 'role.', label: 'Perfis e permissões' },
  { prefix: 'cash.', label: 'Caixa' },
  { prefix: 'sale.', label: 'Vendas' },
  { prefix: 'quote.', label: 'Orçamentos de venda' },
  { prefix: 'os.', label: 'Ordens de serviço' },
  { prefix: 'kanban.', label: 'Kanban' },
  { prefix: 'product.', label: 'Produtos' },
  { prefix: 'stock.', label: 'Estoque' },
  { prefix: 'customer.', label: 'Clientes' },
  { prefix: 'settings.', label: 'Configurações' },
] as const;

export function auditActionLabel(action: string): string {
  return (AUDIT_ACTION_LABELS as Record<string, string>)[action] ?? action;
}

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  User: 'Usuário',
  Role: 'Perfil',
  CashSession: 'Caixa',
  CashMovement: 'Movimento de caixa',
  Sale: 'Venda',
  ServiceOrder: 'OS',
  KanbanColumn: 'Coluna do Kanban',
  Product: 'Produto',
  Customer: 'Cliente',
  FeeRule: 'Taxas',
  StoreSettings: 'Configurações',
};

export function auditEntityLabel(entity: string): string {
  return AUDIT_ENTITY_LABELS[entity] ?? entity;
}

export const AUDIT_FIELD_LABELS: Record<string, string> = {
  id: 'ID',
  number: 'Número',
  name: 'Nome',
  email: 'E-mail',
  login: 'Usuário',
  role: 'Perfil',
  roleId: 'ID do perfil',
  active: 'Ativo',
  createdAt: 'Criado em',
  updatedAt: 'Atualizado em',
  lastLoginAt: 'Último acesso',
  lockedUntil: 'Bloqueado até',
  mustChangePassword: 'Trocar senha no próximo acesso',
  permissions: 'Permissões',
  discountLimitBps: 'Limite de desconto',
  status: 'Situação',
  origin: 'Origem',
  reason: 'Motivo',
  method: 'Forma de pagamento',
  totalCents: 'Total',
  grossCents: 'Bruto',
  discountCents: 'Desconto',
  paidCents: 'Pago',
  pendingCents: 'A receber',
  receivedCents: 'Recebido',
  balanceCents: 'Saldo',
  feeCents: 'Taxa',
  reversedCents: 'Estornado',
  amountCents: 'Valor',
  openingCents: 'Fundo de troco',
  expectedCashCents: 'Esperado na gaveta',
  countedCashCents: 'Contado',
  differenceCents: 'Diferença',
  requiresNote: 'Exigiu observação',
  notes: 'Observação',
  effectiveDiscountBps: 'Desconto aplicado',
  serviceOrderNumber: 'OS',
  saleNumber: 'Venda',
  column: 'Etapa',
  device: 'Aparelho',
  customerId: 'ID do cliente',
  parentOsId: 'OS de origem',
  items: 'Itens',
  itemsCount: 'Quantidade de itens',
  diagnosis: 'Diagnóstico',
  diagnosisFeeCents: 'Taxa de diagnóstico',
  approvalStatus: 'Aprovação',
  by: 'Quem respondeu',
  channel: 'Canal',
  warrantyUntil: 'Garantia até',
  color: 'Cor',
  order: 'Ordem',
  archived: 'Arquivada',
  stageType: 'Tipo de etapa',
  template: 'Modelo',
  templateId: 'ID do modelo',
  templateBody: 'Mensagem',
  requiredFields: 'Campos obrigatórios',
  whatsappEnabled: 'WhatsApp ativo',
  whatsappTrigger: 'Envio do WhatsApp',
};

const ENUM_LABELS: Record<string, Record<string, string>> = {
  status: { ...SALE_STATUS_LABELS, open: 'Aberto', closed: 'Fechado' },
  origin: SALE_ORIGIN_LABELS,
  method: PAYMENT_METHOD_LABELS,
  channel: APPROVAL_CHANNEL_LABELS,
  stageType: STAGE_TYPE_LABELS,
  approvalStatus: { approved: 'Aprovado', rejected: 'Recusado', pending: 'Aguardando resposta' },
  whatsappTrigger: { on_move: 'Ao mover o card', manual: 'Manual' },
};

const PERMISSION_LABELS = new Map<string, string>(PERMISSIONS.map((permission) => [permission.key, permission.label]));
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function auditFieldLabel(key: string): string {
  return AUDIT_FIELD_LABELS[key] ?? key;
}

export function auditPermissionLabel(key: string): string {
  return PERMISSION_LABELS.get(key) ?? key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatItem(item: unknown): string {
  if (!isRecord(item)) return formatAuditValue('', item);
  const name = typeof item.name === 'string' ? item.name : JSON.stringify(item);
  const qty = typeof item.qty === 'number' ? `${item.qty}× ` : '';
  const price = typeof item.unitPriceCents === 'number' ? ` (${formatMoney(item.unitPriceCents)})` : '';
  return `${qty}${name}${price}`;
}

export function formatAuditValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') {
    if (key.endsWith('Cents')) return formatMoney(value);
    if (key.endsWith('Bps')) return formatBps(value);
    return value.toLocaleString('pt-BR');
  }
  if (typeof value === 'string') {
    const label = ENUM_LABELS[key]?.[value];
    if (label) return label;
    if (ISO_DATE_TIME.test(value)) return formatDateTime(value);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Nenhum';
    if (key === 'permissions') return value.map((item) => auditPermissionLabel(String(item))).join('; ');
    return value.map((item) => (isRecord(item) ? formatItem(item) : formatAuditValue(key, item))).join('; ');
  }
  if (isRecord(value) && typeof value.name === 'string') return value.name;
  return JSON.stringify(value);
}

export interface AuditFieldChange {
  key: string;
  before: unknown;
  after: unknown;
  changed: boolean;
}

export interface AuditDiff {
  mode: 'change' | 'created' | 'removed' | 'empty';
  fields: AuditFieldChange[];
  permissions: { added: string[]; removed: string[] } | null;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function auditDiff(before: unknown, after: unknown): AuditDiff {
  const prev = isRecord(before) ? before : null;
  const next = isRecord(after) ? after : null;
  if (!prev && !next) return { mode: 'empty', fields: [], permissions: null };
  if (!prev) return { mode: 'created', fields: Object.keys(next!).filter((key) => key !== 'id').map((key) => ({ key, before: undefined, after: next![key], changed: true })), permissions: null };
  if (!next) return { mode: 'removed', fields: Object.keys(prev).map((key) => ({ key, before: prev[key], after: undefined, changed: true })), permissions: null };
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(next)])];
  const fields = keys.map((key) => ({ key, before: prev[key], after: next[key], changed: key in next && !same(prev[key], next[key]) }));
  const permissions =
    Array.isArray(prev.permissions) && Array.isArray(next.permissions) && !same(prev.permissions, next.permissions)
      ? {
          added: next.permissions.map(String).filter((key) => !(prev.permissions as unknown[]).includes(key)),
          removed: prev.permissions.map(String).filter((key) => !(next.permissions as unknown[]).includes(key)),
        }
      : null;
  return { mode: 'change', fields, permissions };
}

export function auditRecordLabel(entity: string, before: unknown, after: unknown): string {
  const source = { ...(isRecord(before) ? before : {}), ...(isRecord(after) ? after : {}) };
  const label = auditEntityLabel(entity);
  if (typeof source.number === 'string' && source.number) return source.number;
  if (typeof source.name === 'string' && source.name) return `${label} ${source.name}`;
  return label;
}
