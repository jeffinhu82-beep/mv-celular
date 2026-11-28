import { REQUIRED_FIELD_OPTIONS, type RequiredFieldKey } from './constants.ts';
import { firstName } from './br.ts';
import { formatDate, formatMoney } from './format.ts';
import type { PermissionKey } from './permissions.ts';
import type { TemplateValues } from './templates.ts';

export const OS_ACCESS: PermissionKey[] = ['os.edit', 'os.move', 'os.view_all', 'os.quote_edit'];
export const CLOSED_WINDOW_DAYS = 30;
export const DIAGNOSIS_FEE_LABEL = 'Taxa de diagnóstico';

export interface RequiredFieldState {
  itemsCount: number;
  diagnosis: string | null;
  technicianId: string | null;
  approvalStatus: string | null;
  dueAt: Date | string | null;
}

export function missingRequiredFields(state: RequiredFieldState, required: readonly string[]): RequiredFieldKey[] {
  const checks: Record<RequiredFieldKey, boolean> = {
    items: state.itemsCount > 0,
    diagnosis: Boolean(state.diagnosis?.trim()),
    technician: Boolean(state.technicianId),
    approval: state.approvalStatus === 'approved',
    dueAt: Boolean(state.dueAt),
  };
  return REQUIRED_FIELD_OPTIONS.map((option) => option.key).filter((key) => required.includes(key) && !checks[key]);
}

export function requiredFieldsMessage(columnName: string, missing: readonly RequiredFieldKey[]): string {
  const labels = missing.map((key) => REQUIRED_FIELD_OPTIONS.find((option) => option.key === key)?.label.toLowerCase() ?? key);
  return `Para entrar em "${columnName}" falta: ${labels.join(', ')}.`;
}

export interface OsTemplateInput {
  number: string;
  customerName: string;
  brand: string;
  model: string;
  reportedIssue: string;
  totalCents: number;
  balanceCents: number;
  dueAt: Date | string | null;
  warrantyDays: number;
}

export interface StoreTemplateInput {
  name: string;
  phone?: string | null;
  address?: string | null;
}

export function serviceOrderTemplateValues(os: OsTemplateInput, store: StoreTemplateInput): TemplateValues {
  return {
    cliente: os.customerName,
    primeiro_nome: firstName(os.customerName) || 'tudo bem',
    numero_os: os.number,
    aparelho: `${os.brand} ${os.model}`.trim(),
    defeito: os.reportedIssue,
    valor_total: formatMoney(os.totalCents),
    valor_restante: formatMoney(Math.max(0, os.balanceCents)),
    previsao: os.dueAt ? formatDate(os.dueAt) : 'a combinar',
    garantia_dias: String(os.warrantyDays),
    loja: store.name,
    telefone_loja: store.phone ?? '',
    endereco_loja: store.address ?? '',
  };
}
