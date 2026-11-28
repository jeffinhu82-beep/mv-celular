import { DEFAULT_ROLES, DEFAULT_TEMPLATES, type RequiredFieldKey } from '@loja/shared';
import type { Tx } from '../db.ts';
import { hashPassword } from '../lib/password.ts';
import { defaultFeeRules } from '../services/settings.ts';

export const SEED_PASSWORD = 'loja12345';

export interface SeedUser {
  login: string;
  email: string;
  name: string;
  role: string;
}

export interface StoreIdentity {
  document?: string;
  address?: string;
  whatsapp?: string;
  pixKey?: string;
  openingHours?: string;
}

export const DEMO_STORE: StoreIdentity = {
  document: '11222333000181',
  address: 'Rua Felipe Schmidt, 321 - Centro, Florianópolis/SC',
  whatsapp: '+5548999990000',
  pixKey: 'contato@loja.com.br',
  openingHours: 'Seg a sex 9h às 18h, sáb 9h às 13h',
};

export const SEED_USERS = [
  { login: 'admin', email: 'carlos@loja.test', name: 'Carlos Menezes', role: 'admin' },
  { login: 'ana', email: 'ana@loja.test', name: 'Ana Souza', role: 'cashier' },
  { login: 'diego', email: 'diego@loja.test', name: 'Diego Ramos', role: 'technician' },
  { login: 'rafael', email: 'rafael@loja.test', name: 'Rafael Lima', role: 'technician' },
] as const;

interface ColumnSeed {
  name: string;
  color: string;
  stageType: 'entry' | 'in_progress' | 'ready' | 'done' | 'cancelled';
  requiredFields?: RequiredFieldKey[];
  whatsapp?: { trigger: 'on_move' | 'manual'; template: keyof typeof DEFAULT_TEMPLATES };
}

export const DEFAULT_COLUMNS: ColumnSeed[] = [
  { name: 'Recebido', color: '#79AEE0', stageType: 'entry', whatsapp: { trigger: 'manual', template: 'received' } },
  { name: 'Em análise', color: '#A99AE6', stageType: 'in_progress' },
  { name: 'Orçamento enviado', color: '#F0A83C', stageType: 'in_progress', requiredFields: ['items'], whatsapp: { trigger: 'on_move', template: 'quoteSent' } },
  { name: 'Aguardando aprovação', color: '#EC8A4C', stageType: 'in_progress', requiredFields: ['items'] },
  { name: 'Em conserto', color: '#E93737', stageType: 'in_progress', requiredFields: ['approval'] },
  { name: 'Aguardando peça', color: '#E27BA8', stageType: 'in_progress' },
  { name: 'Pronto para retirada', color: '#4CC38A', stageType: 'ready', requiredFields: ['diagnosis'], whatsapp: { trigger: 'on_move', template: 'ready' } },
  { name: 'Entregue', color: '#2F9D6B', stageType: 'done', whatsapp: { trigger: 'manual', template: 'delivered' } },
  { name: 'Não aprovado / Cancelado', color: '#8C8381', stageType: 'cancelled' },
];

export const EXPENSE_CATEGORIES = ['Peças', 'Aluguel', 'Energia', 'Internet', 'Alimentação', 'Frete', 'Material de escritório', 'Outros'];

const TEMPLATE_NAMES: Record<keyof typeof DEFAULT_TEMPLATES, string> = {
  received: 'OS recebida',
  quoteSent: 'Orçamento enviado',
  ready: 'Pronto para retirada',
  delivered: 'Entregue',
  saleQuote: 'Orçamento de venda',
  saleReceipt: 'Comprovante de venda',
};

export interface SeedBaseOptions {
  storeName?: string;
  password?: string;
  store?: StoreIdentity;
  users?: readonly SeedUser[];
  mustChangePassword?: boolean;
}

export async function seedBase(db: Tx, options: SeedBaseOptions = {}) {
  const passwordHash = await hashPassword(options.password ?? SEED_PASSWORD);
  await db.storeSettings.create({
    data: {
      name: options.storeName ?? '[Nome da Loja]',
      ...(options.store ?? DEMO_STORE),
      warrantyDays: 90,
      quoteValidityDays: 7,
      staleOsDays: 3,
      staleQuoteDays: 3,
      maxInstallments: 12,
      minInstallmentCents: 2000,
      printDefaultSize: '80mm',
      warrantyTerms:
        'Garantia de {garantia_dias} dias para o serviço executado e as peças trocadas. A garantia não cobre quedas, contato com líquidos, mau uso ou aparelho aberto por terceiros.',
      entryTerms:
        'O cliente declara que as informações do aparelho são verdadeiras. Aparelhos não retirados em até 90 dias após o aviso de pronto poderão ser descartados ou vendidos para cobrir os custos, conforme a lei. A loja não se responsabiliza por dados não salvos.',
      receiptFooter: 'Documento não fiscal. Obrigado pela preferência!',
    },
  });

  const roles = new Map<string, string>();
  for (const role of DEFAULT_ROLES) {
    const created = await db.role.create({
      data: {
        slug: role.slug,
        name: role.name,
        discountLimitBps: role.discountLimitBps,
        system: true,
        permissions: { create: role.permissions.map((permissionKey) => ({ permissionKey })) },
      },
    });
    roles.set(role.slug, created.id);
  }

  const users = new Map<string, string>();
  for (const user of options.users ?? SEED_USERS) {
    const created = await db.user.create({
      data: { login: user.login, email: user.email, name: user.name, roleId: roles.get(user.role)!, passwordHash, mustChangePassword: options.mustChangePassword ?? false },
    });
    users.set(user.login, created.id);
  }

  const templates = new Map<string, string>();
  for (const [key, body] of Object.entries(DEFAULT_TEMPLATES)) {
    const created = await db.messageTemplate.create({ data: { name: TEMPLATE_NAMES[key as keyof typeof DEFAULT_TEMPLATES], body } });
    templates.set(key, created.id);
  }

  const columns = new Map<string, string>();
  for (const [order, column] of DEFAULT_COLUMNS.entries()) {
    const created = await db.kanbanColumn.create({
      data: {
        name: column.name,
        color: column.color,
        order,
        stageType: column.stageType,
        requiredFields: column.requiredFields ?? [],
        whatsappEnabled: Boolean(column.whatsapp),
        whatsappTrigger: column.whatsapp?.trigger ?? 'manual',
        templateId: column.whatsapp ? templates.get(column.whatsapp.template)! : null,
      },
    });
    columns.set(column.name, created.id);
  }

  await db.feeRule.createMany({ data: defaultFeeRules() });
  await db.expenseCategory.createMany({ data: EXPENSE_CATEGORIES.map((name) => ({ name })) });

  return { roles, users, columns, templates };
}
