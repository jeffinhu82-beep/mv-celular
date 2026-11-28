import { z } from 'zod';
import { isValidCpf, isValidCnpj, normalizePhoneBR } from './br.ts';
import {
  APPROVAL_CHANNELS,
  OS_ITEM_KINDS,
  PRINT_SIZES,
  PRODUCT_TYPES,
  REQUIRED_FIELD_OPTIONS,
  STAGE_TYPES,
  UNLOCK_TYPES,
  WHATSAPP_TRIGGERS,
} from './constants.ts';
import { onlyDigits } from './format.ts';
import { PAYMENT_METHODS } from './money/fees.ts';
import { PERMISSION_KEYS } from './permissions.ts';

const cents = z.int('Informe um valor em centavos').min(0, 'O valor não pode ser negativo');
const positiveCents = z.int('Informe um valor em centavos').min(1, 'Informe um valor maior que zero');
const bps = z.int().min(0).max(10000);
const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((value) => (value ? value : null));
const requiredText = (label: string, max = 200) => z.string().trim().min(1, `${label} é obrigatório`).max(max);
const uuid = z.uuid('Identificador inválido');
const optionalUuid = z
  .union([z.uuid(), z.literal(''), z.null()])
  .optional()
  .transform((value) => (value ? value : null));

export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

export const approvalSchema = z
  .object({
    login: z.string().trim().min(1),
    password: z.string().min(1),
  })
  .optional()
  .nullable();

export const loginSchema = z.object({
  login: z.string().trim().min(1, 'Informe o e-mail ou usuário').max(160),
  password: z.string().min(1, 'Informe a senha').max(200),
});

export const passwordSchema = z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres').max(200);

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual'),
  newPassword: passwordSchema,
});

const userEmail = z.string().trim().toLowerCase().min(1, 'Informe o e-mail').max(160).pipe(z.email('E-mail inválido'));

export const userCreateSchema = z.object({
  name: requiredText('Nome', 120),
  login: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'O login precisa ter pelo menos 3 caracteres')
    .max(40)
    .regex(/^[a-z0-9._-]+$/, 'Use só letras minúsculas, números, ponto, hífen ou sublinhado'),
  email: userEmail,
  roleId: uuid,
  temporaryPassword: passwordSchema,
});

export const userUpdateSchema = z.object({
  name: requiredText('Nome', 120).optional(),
  email: userEmail.optional(),
  roleId: uuid.optional(),
  active: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({ temporaryPassword: passwordSchema });

export const roleSchema = z.object({
  name: requiredText('Nome do perfil', 60),
  discountLimitBps: bps,
  permissions: z.array(z.enum(PERMISSION_KEYS as [string, ...string[]])),
});

export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'WhatsApp é obrigatório')
  .refine((value) => normalizePhoneBR(value) !== null, 'WhatsApp inválido. Use DDD + número')
  .transform((value) => normalizePhoneBR(value) as string);

export const customerSchema = z.object({
  name: requiredText('Nome', 120),
  phone: phoneSchema,
  cpf: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((value) => !value || isValidCpf(value), 'CPF inválido')
    .transform((value) => (value ? onlyDigits(value) : null)),
  email: z
    .union([z.email('E-mail inválido'), z.literal(''), z.null()])
    .optional()
    .transform((value) => (value ? value : null)),
  address: optionalText,
  notes: optionalText,
});

export const quickCustomerSchema = customerSchema.pick({ name: true, phone: true });

export const categorySchema = z.object({ name: requiredText('Nome', 80) });

export const productSchema = z.object({
  type: z.enum(PRODUCT_TYPES).default('product'),
  name: requiredText('Nome', 160),
  sku: optionalText,
  barcode: optionalText,
  categoryId: optionalUuid,
  costCents: cents.default(0),
  priceCents: cents,
  minStock: z.int().min(0).default(0),
  tracksStock: z.boolean().default(true),
  active: z.boolean().default(true),
  estimatedMinutes: z.int().min(0).optional().nullable(),
  photoUrl: optionalText,
  initialStock: z.int().min(0).optional(),
});

export const stockEntrySchema = z.object({
  productId: uuid,
  qty: z.int().min(1, 'Quantidade precisa ser maior que zero'),
  unitCostCents: cents,
  supplier: optionalText,
  notes: optionalText,
});

export const stockAdjustSchema = z.object({
  productId: uuid,
  qtyDelta: z.int().refine((value) => value !== 0, 'Informe uma quantidade diferente de zero'),
  reason: requiredText('Motivo', 300),
});

export const storeSettingsSchema = z.object({
  name: requiredText('Nome da loja', 120),
  document: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((value) => !value || isValidCpf(value) || isValidCnpj(value), 'CPF ou CNPJ inválido')
    .transform((value) => (value ? onlyDigits(value) : null)),
  address: optionalText,
  whatsapp: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((value) => !value || normalizePhoneBR(value) !== null, 'WhatsApp inválido')
    .transform((value) => (value ? normalizePhoneBR(value) : null)),
  logoUrl: optionalText,
  pixKey: optionalText,
  openingHours: optionalText,
});

export const printSettingsSchema = z.object({
  printDefaultSize: z.enum(PRINT_SIZES),
  warrantyTerms: z.string().max(4000),
  entryTerms: z.string().max(4000),
  receiptFooter: z.string().max(1000),
});

export const defaultsSettingsSchema = z.object({
  warrantyDays: z.int().min(0).max(3650),
  quoteValidityDays: z.int().min(1).max(365),
  staleOsDays: z.int().min(1).max(365),
  staleQuoteDays: z.int().min(1).max(365),
});

export const feeRuleSchema = z.object({
  method: paymentMethodSchema,
  installments: z.int().min(1).max(12),
  percentBps: z.int().min(0).max(9999),
  fixedCents: cents,
  passToCustomer: z.boolean(),
});

export const feeSettingsSchema = z.object({
  rules: z.array(feeRuleSchema),
  maxInstallments: z.int().min(1).max(12),
  minInstallmentCents: cents,
});

export const expenseCategorySchema = z.object({ name: requiredText('Nome', 80), active: z.boolean().default(true) });

export const cashOpenSchema = z.object({ openingCents: cents });

export const cashMovementSchema = z
  .object({
    type: z.enum(['income', 'supply', 'withdrawal', 'expense']),
    method: paymentMethodSchema.default('cash'),
    amountCents: positiveCents,
    description: requiredText('Descrição', 300),
    categoryId: optionalUuid,
    fromDrawer: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'expense' && !value.categoryId) {
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Escolha a categoria do custo' });
    }
  });

export const cashCloseSchema = z.object({ countedCashCents: cents, notes: optionalText });
export const cashReopenSchema = z.object({ reason: requiredText('Motivo', 300) });

export const discountSchema = z.object({
  mode: z.enum(['amount', 'percent']),
  value: z.int().min(0),
});

export const saleItemInputSchema = z.object({
  productId: optionalUuid,
  name: requiredText('Nome do item', 200),
  qty: z.int().min(1, 'Quantidade mínima é 1'),
  unitPriceCents: cents,
  discount: discountSchema.optional(),
});

export const paymentInputSchema = z.object({
  method: paymentMethodSchema,
  amountCents: positiveCents,
  installments: z.int().min(1).max(12).optional(),
});

export const saleCreateSchema = z.object({
  customerId: optionalUuid,
  items: z.array(saleItemInputSchema).min(1, 'Adicione pelo menos um item'),
  discount: discountSchema.optional(),
  notes: optionalText,
  payments: z.array(paymentInputSchema).default([]),
  allowPending: z.boolean().default(false),
  quoteId: optionalUuid,
  approval: approvalSchema,
});

export const quoteCreateSchema = z.object({
  customerId: optionalUuid,
  items: z.array(saleItemInputSchema).min(1, 'Adicione pelo menos um item'),
  discount: discountSchema.optional(),
  notes: optionalText,
  validityDays: z.int().min(1).max(365).optional(),
  approval: approvalSchema,
});

export const saleCancelSchema = z.object({
  reason: requiredText('Motivo', 300),
  approval: approvalSchema,
});

export const receivePaymentsSchema = z.object({
  payments: z.array(paymentInputSchema).min(1, 'Adicione um pagamento'),
});

export const checklistSchema = z.record(z.string(), z.union([z.boolean(), z.string()]));

export const serviceOrderCreateSchema = z.object({
  customerId: uuid,
  deviceType: requiredText('Tipo do aparelho', 40),
  brand: requiredText('Marca', 60),
  model: requiredText('Modelo', 80),
  color: optionalText,
  serialImei: optionalText,
  unlockType: z.enum(UNLOCK_TYPES).default('none'),
  unlockSecret: optionalText,
  accessories: optionalText,
  checklist: checklistSchema.default({}),
  reportedIssue: requiredText('Defeito relatado', 1000),
  dueAt: z.iso.datetime({ offset: true }).optional().nullable(),
  technicianId: optionalUuid,
  parentOsId: optionalUuid,
  warrantyDays: z.int().min(0).max(3650).optional(),
});

export const serviceOrderUpdateSchema = serviceOrderCreateSchema
  .omit({ customerId: true, parentOsId: true, unlockType: true, checklist: true })
  .partial()
  .extend({
    customerId: uuid.optional(),
    unlockType: z.enum(UNLOCK_TYPES).optional(),
    checklist: checklistSchema.optional(),
    diagnosis: optionalText,
  });

export const serviceOrderItemInputSchema = z.object({
  productId: optionalUuid,
  kind: z.enum(OS_ITEM_KINDS),
  name: requiredText('Nome do item', 200),
  qty: z.int().min(1),
  unitPriceCents: cents,
});

export const serviceOrderQuoteSchema = z.object({
  items: z.array(serviceOrderItemInputSchema),
  discountCents: cents.default(0),
});

export const serviceOrderMoveSchema = z.object({
  columnId: uuid,
  position: z.int().min(0).optional(),
  afterId: z.uuid().nullable().optional(),
});

export const serviceOrderApprovalSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  by: requiredText('Quem respondeu', 120),
  channel: z.enum(APPROVAL_CHANNELS),
  diagnosisFeeCents: cents.default(0),
});

export const serviceOrderDepositSchema = z.object({
  payments: z.array(paymentInputSchema).min(1, 'Adicione um pagamento'),
});

export const serviceOrderCheckoutSchema = z.object({
  payments: z.array(paymentInputSchema).default([]),
  allowPending: z.boolean().default(false),
  approval: approvalSchema,
});

export const whatsappLogSchema = z.object({ context: z.string().trim().max(60).optional() });

export const OS_PRINT_KINDS = ['entry', 'quote', 'delivery'] as const;
export const serviceOrderPrintSchema = z.object({ kind: z.enum(OS_PRINT_KINDS) });

export const kanbanColumnSchema = z.object({
  name: requiredText('Nome da coluna', 60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida'),
  stageType: z.enum(STAGE_TYPES),
  requiredFields: z.array(z.enum(REQUIRED_FIELD_OPTIONS.map((option) => option.key) as [string, ...string[]])).default([]),
  whatsappEnabled: z.boolean().default(false),
  whatsappTrigger: z.enum(WHATSAPP_TRIGGERS).default('manual'),
  templateBody: z.string().max(2000).optional().nullable(),
  archived: z.boolean().default(false),
});

export const columnsOrderSchema = z.object({ ids: z.array(uuid).min(1) });

export type LoginInput = z.infer<typeof loginSchema>;
export type CustomerInput = z.input<typeof customerSchema>;
export type ProductInput = z.input<typeof productSchema>;
export type SaleCreateInput = z.input<typeof saleCreateSchema>;
export type QuoteCreateInput = z.input<typeof quoteCreateSchema>;
export type SaleItemInput = z.input<typeof saleItemInputSchema>;
export type PaymentInputData = z.input<typeof paymentInputSchema>;
export type ServiceOrderCreateInput = z.input<typeof serviceOrderCreateSchema>;
export type ServiceOrderItemInput = z.input<typeof serviceOrderItemInputSchema>;
export type KanbanColumnInput = z.input<typeof kanbanColumnSchema>;
export type FeeSettingsInput = z.input<typeof feeSettingsSchema>;
export type CashMovementInput = z.input<typeof cashMovementSchema>;
