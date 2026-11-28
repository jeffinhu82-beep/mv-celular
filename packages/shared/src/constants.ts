export const STAGE_TYPES = ['entry', 'in_progress', 'ready', 'done', 'cancelled'] as const;
export type StageType = (typeof STAGE_TYPES)[number];

export const STAGE_TYPE_LABELS: Record<StageType, string> = {
  entry: 'Entrada',
  in_progress: 'Andamento',
  ready: 'Pronto',
  done: 'Finalizado',
  cancelled: 'Cancelado',
};

export const OPEN_STAGE_TYPES: StageType[] = ['entry', 'in_progress', 'ready'];
export const CLOSED_STAGE_TYPES: StageType[] = ['done', 'cancelled'];
export const LATE_STAGE_TYPES: StageType[] = ['entry', 'in_progress'];

export function isLate(stageType: StageType, dueAt: Date | null, now: Date) {
  return LATE_STAGE_TYPES.includes(stageType) && Boolean(dueAt && dueAt < now);
}

export const REQUIRED_FIELD_OPTIONS = [
  { key: 'items', label: 'Pelo menos um item no orçamento' },
  { key: 'diagnosis', label: 'Diagnóstico preenchido' },
  { key: 'technician', label: 'Técnico definido' },
  { key: 'approval', label: 'Aprovação registrada' },
  { key: 'dueAt', label: 'Previsão de entrega' },
] as const;
export type RequiredFieldKey = (typeof REQUIRED_FIELD_OPTIONS)[number]['key'];

export const WHATSAPP_TRIGGERS = ['on_move', 'manual'] as const;
export type WhatsappTrigger = (typeof WHATSAPP_TRIGGERS)[number];

export const SALE_STATUSES = ['quote', 'completed', 'pending', 'cancelled'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  quote: 'Orçamento',
  completed: 'Concluída',
  pending: 'Pendente',
  cancelled: 'Cancelada',
};

export const SALE_ORIGINS = ['counter', 'os'] as const;
export type SaleOrigin = (typeof SALE_ORIGINS)[number];
export const SALE_ORIGIN_LABELS: Record<SaleOrigin, string> = { counter: 'Balcão', os: 'OS' };

export const OS_ITEM_KINDS = ['part', 'service', 'labor'] as const;
export type OsItemKind = (typeof OS_ITEM_KINDS)[number];
export const OS_ITEM_KIND_LABELS: Record<OsItemKind, string> = {
  part: 'Peça',
  service: 'Serviço',
  labor: 'Mão de obra',
};

export const OS_EVENT_TYPES = [
  'created',
  'moved',
  'edited',
  'whatsapp_opened',
  'payment',
  'approved',
  'rejected',
  'quote_updated',
  'delivered',
  'secret_viewed',
  'printed',
] as const;
export type OsEventType = (typeof OS_EVENT_TYPES)[number];

export const APPROVAL_CHANNELS = ['whatsapp', 'presencial', 'telefone', 'outro'] as const;
export type ApprovalChannel = (typeof APPROVAL_CHANNELS)[number];
export const APPROVAL_CHANNEL_LABELS: Record<ApprovalChannel, string> = {
  whatsapp: 'WhatsApp',
  presencial: 'Presencial',
  telefone: 'Telefone',
  outro: 'Outro',
};

export const DEVICE_TYPES = ['Celular', 'Tablet', 'Notebook', 'Smartwatch', 'Console', 'Outro'] as const;

export const UNLOCK_TYPES = ['none', 'pin', 'password', 'pattern'] as const;
export type UnlockType = (typeof UNLOCK_TYPES)[number];
export const UNLOCK_TYPE_LABELS: Record<UnlockType, string> = {
  none: 'Sem senha',
  pin: 'PIN',
  password: 'Senha',
  pattern: 'Padrão',
};

export const DEFAULT_CHECKLIST = [
  'Liga normalmente',
  'Tela sem trincas',
  'Touch funcionando',
  'Câmera traseira',
  'Câmera frontal',
  'Alto-falante',
  'Microfone',
  'Wi-Fi e Bluetooth',
  'Carrega',
  'Biometria / Face ID',
  'Botões',
  'Bandeja de chip',
  'Riscos ou amassados',
] as const;

export const STOCK_MOVEMENT_TYPES = ['purchase', 'sale', 'os_use', 'adjust', 'reversal'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  purchase: 'Entrada',
  sale: 'Venda',
  os_use: 'Uso em OS',
  adjust: 'Ajuste',
  reversal: 'Estorno',
};

export const PRINT_SIZES = ['80mm', '58mm', 'A4'] as const;
export type PrintSize = (typeof PRINT_SIZES)[number];

export const PRODUCT_TYPES = ['product', 'service'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
