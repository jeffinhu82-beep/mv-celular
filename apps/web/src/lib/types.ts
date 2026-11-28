import type { CashMovementType, DiscountMode, MethodTotals, PaymentMethod, PeriodKind, PermissionKey, SaleOrigin, SaleStatus, StageType, SummaryResult } from '@loja/shared';

export interface Paged<T> {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
}

export interface StoreSettings {
  id: string;
  name: string;
  document: string | null;
  address: string | null;
  whatsapp: string | null;
  logoUrl: string | null;
  pixKey: string | null;
  openingHours: string | null;
  warrantyDays: number;
  quoteValidityDays: number;
  staleOsDays: number;
  staleQuoteDays: number;
  maxInstallments: number;
  minInstallmentCents: number;
  printDefaultSize: '80mm' | '58mm' | 'A4';
  warrantyTerms: string;
  entryTerms: string;
  receiptFooter: string;
}

export interface Customer {
  id: string;
  name: string;
  phoneE164: string;
  cpf: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  anonymizedAt: string | null;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  _count?: { products: number };
}

export interface Product {
  id: string;
  type: 'product' | 'service';
  name: string;
  sku: string | null;
  barcode: string | null;
  categoryId: string | null;
  category: Category | null;
  costCents?: number;
  priceCents: number;
  stockQty: number;
  minStock: number;
  tracksStock: boolean;
  active: boolean;
  estimatedMinutes: number | null;
  photoUrl: string | null;
  marginBps?: number | null;
  reservedQty: number;
  availableQty: number;
  lowStock: boolean;
}

export interface StockMovement {
  id: string;
  productId: string;
  product: { id: string; name: string };
  type: 'purchase' | 'sale' | 'os_use' | 'adjust' | 'reversal';
  qty: number;
  unitCostCents?: number;
  balanceAfter: number;
  reason: string | null;
  supplier: string | null;
  refType: string | null;
  refId: string | null;
  refNumber: string | null;
  userName: string | null;
  createdAt: string;
}

export interface Role {
  id: string;
  slug: string | null;
  name: string;
  discountLimitBps: number;
  system: boolean;
  permissions: PermissionKey[];
  userCount: number;
}

export interface TeamUser {
  id: string;
  name: string;
  login: string;
  email: string | null;
  roleId: string;
  role: { id: string; name: string };
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
}

export interface UserOption {
  id: string;
  name: string;
  roleName: string;
  isTechnician: boolean;
  canSell: boolean;
}

export interface FeeRuleRow {
  method: PaymentMethod;
  installments: number;
  percentBps: number;
  fixedCents: number;
  passToCustomer: boolean;
}

export interface FeeSettings {
  rules: FeeRuleRow[];
  maxInstallments: number;
  minInstallmentCents: number;
}

export interface MessageTemplate {
  id: string;
  name: string;
  body: string;
}

export interface KanbanColumn {
  id: string;
  name: string;
  color: string;
  order: number;
  stageType: StageType;
  requiredFields: string[];
  whatsappEnabled: boolean;
  whatsappTrigger: 'on_move' | 'manual';
  templateId: string | null;
  template: MessageTemplate | null;
  archived: boolean;
  _count?: { serviceOrders: number };
}

export interface ExpenseCategory {
  id: string;
  name: string;
  active: boolean;
}

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userName: string | null;
  approvedByName: string | null;
  createdAt: string;
}

export interface CashMovementView {
  id: string;
  sessionId: string;
  type: CashMovementType;
  method: PaymentMethod;
  amountCents: number;
  feeCents?: number;
  fromDrawer: boolean;
  categoryId: string | null;
  categoryName: string | null;
  description: string;
  refType: string | null;
  refId: string | null;
  refNumber: string | null;
  userName: string;
  approvedByName: string | null;
  occurredAt: string;
}

export interface CashSessionView {
  id: string;
  status: 'open' | 'closed';
  openedAt: string;
  openedByName: string;
  openingCents: number;
  closedAt: string | null;
  closedByName: string | null;
  countedCashCents: number | null;
  expectedCashCents: number | null;
  expected: MethodTotals | null;
  differenceCents: number | null;
  notes: string | null;
  reopenedAt: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
  expectedNow: MethodTotals;
  movements: CashMovementView[];
}

export interface CashSessionRow {
  id: string;
  status: 'open' | 'closed';
  openedAt: string;
  openedByName: string;
  closedAt: string | null;
  closedByName: string | null;
  openingCents: number;
  expectedCashCents: number | null;
  countedCashCents: number | null;
  differenceCents: number | null;
  notes: string | null;
}

export interface SaleItemView {
  id: string;
  productId: string | null;
  name: string;
  qty: number;
  unitPriceCents: number;
  listPriceCents: number | null;
  unitCostCents?: number;
  discountMode: DiscountMode | null;
  discountValue: number | null;
  discountCents: number;
  totalCents: number;
  tracksStock: boolean;
}

export interface PaymentView {
  id: string;
  method: PaymentMethod;
  installments: number;
  amountCents: number;
  coveredCents: number;
  surchargeCents: number;
  changeCents: number;
  feeCents?: number;
  feePercentBps?: number;
  receivedAt: string;
  receivedByName: string;
  reversedAt: string | null;
}

export interface SaleLog {
  id: string;
  action: string;
  createdAt: string;
  userName: string | null;
  approvedByName: string | null;
  after: Record<string, unknown> | null;
}

export interface SaleDetail {
  id: string;
  number: string | null;
  quoteNumber: string | null;
  status: SaleStatus;
  origin: SaleOrigin;
  customer: { id: string; name: string; phoneE164: string; cpf: string | null } | null;
  serviceOrder: { id: string; number: string; brand: string; model: string } | null;
  sellerId: string;
  sellerName: string;
  subtotalCents: number;
  discountCents: number;
  discountMode: DiscountMode | null;
  discountValue: number | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  chargedCents: number;
  changeCents: number;
  costCents?: number;
  feeCents?: number;
  netCents?: number;
  marginCents?: number;
  notes: string | null;
  quoteValidUntil: string | null;
  quoteCreatedAt: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  approvedByName: string | null;
  createdAt: string;
  items: SaleItemView[];
  payments: PaymentView[];
  logs: SaleLog[];
}

export interface SaleRow {
  id: string;
  number: string;
  status: SaleStatus;
  origin: SaleOrigin;
  customer: { id: string; name: string } | null;
  serviceOrder: { id: string; number: string } | null;
  sellerName: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  methods: PaymentMethod[];
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface SaleList {
  items: SaleRow[];
  total: number;
  totalCents: number;
  validCount: number;
}

export interface SaleExportRow extends SaleRow {
  discountCents: number;
  items: { name: string; qty: number }[];
}

export interface SaleExport {
  period: ReportPeriod | null;
  items: SaleExportRow[];
}

export type QuoteListStatus = 'open' | 'expired' | 'converted' | 'cancelled';

export interface QuoteRow {
  id: string;
  quoteNumber: string;
  status: QuoteListStatus;
  saleNumber: string | null;
  customer: { id: string; name: string; phoneE164: string } | null;
  sellerName: string;
  totalCents: number;
  itemsCount: number;
  quoteCreatedAt: string;
  quoteValidUntil: string | null;
  expired: boolean;
}

export interface ChartPoint {
  key: string;
  salesCents: number;
  salesCount: number;
  receivedCents: number;
  resultCents?: number;
}

export interface ReceivableItem {
  kind: 'sale' | 'os';
  id: string;
  number: string;
  label: string;
  customer: { id: string; name: string } | null;
  balanceCents: number;
  since: string;
}

export interface ServiceOrderOverview {
  openCount: number;
  staleCount: number;
  lateCount: number;
  byColumn: { id: string; name: string; color: string; stageType: StageType; count: number }[];
}

export interface DashboardFull {
  mode: 'full';
  period: { kind: PeriodKind; start: string; end: string };
  summary: SummaryResult;
  chart: { granularity: 'hour' | 'day'; points: ChartPoint[] };
  drawer: { sessionId: string; openedAt: string; openedByName: string; expectedCashCents: number } | null;
  receivables: { totalCents: number; count: number; items: ReceivableItem[] };
  lowStock: { count: number; items: { id: string; name: string; stockQty: number; minStock: number }[] };
  serviceOrders: ServiceOrderOverview;
  latestSales: { id: string; number: string | null; status: SaleStatus; origin: SaleOrigin; totalCents: number; completedAt: string | null; customerName: string | null; sellerName: string }[];
}

export interface DashboardReduced {
  mode: 'reduced';
  period: { kind: 'today'; start: string; end: string };
  mySales: { count: number; totalCents: number; items: { id: string; number: string | null; status: SaleStatus; totalCents: number; completedAt: string | null; customerName: string | null }[] };
  myOrders: {
    staleCount: number;
    lateCount: number;
    items: { id: string; number: string; device: string; customerName: string; columnName: string; columnColor: string; dueAt: string | null; late: boolean; stale: boolean }[];
  };
}

export type Dashboard = DashboardFull | DashboardReduced;

export interface OsFlags {
  late: boolean;
  stale: boolean;
  warranty: boolean;
  waitingPart: boolean;
}

export interface OsCustomerRef {
  id: string;
  name: string;
  phoneE164: string;
}

export interface OsSaleRef {
  id: string;
  number: string | null;
  status: SaleStatus;
}

export interface ServiceOrderCard {
  id: string;
  number: string;
  columnId: string;
  position: number;
  deviceType: string;
  brand: string;
  model: string;
  reportedIssue: string;
  customer: OsCustomerRef;
  technicianId: string | null;
  technicianName: string | null;
  dueAt: string | null;
  columnEnteredAt: string;
  closedAt: string | null;
  createdAt: string;
  approvalStatus: 'approved' | 'rejected' | null;
  warrantyDays: number;
  warrantyUntil: string | null;
  sale: OsSaleRef | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  flags: OsFlags;
}

export interface BoardColumn {
  id: string;
  name: string;
  color: string;
  order: number;
  stageType: StageType;
  requiredFields: string[];
  whatsappEnabled: boolean;
  whatsappTrigger: 'on_move' | 'manual';
  template: MessageTemplate | null;
  limited: boolean;
  count: number;
  sumCents: number | null;
  cards: ServiceOrderCard[];
}

export interface BoardResponse {
  now: string;
  staleOsDays: number;
  closedWindowDays: number;
  staff: { id: string; name: string }[];
  columns: BoardColumn[];
}

export interface OsItemView {
  id: string;
  productId: string | null;
  product: { id: string; name: string; sku: string | null; active: boolean } | null;
  kind: 'part' | 'service' | 'labor';
  name: string;
  qty: number;
  unitPriceCents: number;
  unitCostCents?: number;
  totalCents: number;
  tracksStock: boolean;
  availableQty: number | null;
  shortage: boolean;
}

export interface OsPaymentView extends PaymentView {
  saleId: string | null;
  deposit: boolean;
}

export interface OsEventView {
  id: string;
  type: string;
  data: Record<string, unknown> | null;
  userId: string | null;
  userName: string | null;
  createdAt: string;
  fromColumn: { id: string; name: string; color: string } | null;
  toColumn: { id: string; name: string; color: string } | null;
}

export interface ServiceOrderDetail {
  id: string;
  number: string;
  customerId: string;
  customer: OsCustomerRef & { cpf: string | null; anonymizedAt: string | null };
  deviceType: string;
  brand: string;
  model: string;
  color: string | null;
  serialImei: string | null;
  unlockType: 'none' | 'pin' | 'password' | 'pattern';
  hasSecret: boolean;
  accessories: string | null;
  checklist: Record<string, boolean | string>;
  reportedIssue: string;
  diagnosis: string | null;
  technicianId: string | null;
  technicianName: string | null;
  columnId: string;
  column: KanbanColumn;
  columnEnteredAt: string;
  position: number;
  dueAt: string | null;
  discountCents: number;
  diagnosisFeeCents: number;
  approvalStatus: 'approved' | 'rejected' | null;
  approvalBy: string | null;
  approvalAt: string | null;
  approvalChannel: string | null;
  approvalRegisteredByName: string | null;
  warrantyDays: number;
  warrantyActive: boolean;
  deliveredAt: string | null;
  warrantyUntil: string | null;
  closedAt: string | null;
  parentOsId: string | null;
  parentOs: { id: string; number: string; deliveredAt: string | null; warrantyUntil: string | null } | null;
  returns: { id: string; number: string; createdAt: string }[];
  createdById: string;
  createdByName: string | null;
  createdAt: string;
  open: boolean;
  items: OsItemView[];
  payments: OsPaymentView[];
  sale: (OsSaleRef & { totalCents: number; paidCents: number; completedAt: string | null }) | null;
  events: OsEventView[];
  grossCents: number;
  depositCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  flags: OsFlags;
  moved?: boolean;
  delivery?: { saleId: string | null; saleNumber: string | null; status: SaleStatus | null; totalCents: number; paidCents: number; pendingCents: number };
}

export interface ReceivablesList {
  totalCents: number;
  count: number;
  items: (ReceivableItem & { customer: OsCustomerRef | null })[];
}

export interface ReportPeriod {
  kind: string;
  start: string;
  end: string;
}

export interface MethodRow {
  method: PaymentMethod;
  grossCents: number;
  feeCents?: number;
  netCents?: number;
}

export interface SalesReport {
  period: ReportPeriod;
  totals: { count: number; totalCents: number; averageTicketCents: number; receivedCents: number };
  byDay: { day: string; count: number; totalCents: number }[];
  byMethod: MethodRow[];
  bySeller: { sellerId: string; name: string; count: number; totalCents: number; averageTicketCents: number }[];
  topProducts: { productId: string | null; name: string; qty: number; totalCents: number }[];
}

export interface SoldItemRow {
  id: string;
  saleId: string;
  saleNumber: string;
  completedAt: string;
  serviceOrderNumber: string | null;
  productId: string | null;
  name: string;
  qty: number;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
  sellerName: string;
  customerName: string | null;
}

export interface SoldItemsReport {
  period: ReportPeriod;
  items: SoldItemRow[];
}

export interface ServiceOrderReport {
  period: ReportPeriod;
  totals: { opened: number; completed: number; averageReadyMs: number | null };
  byTechnician: { technicianId: string | null; name: string | null; opened: number; completed: number; averageReadyMs: number | null }[];
}

export interface CashClosingRow {
  id: string;
  status: string;
  openedAt: string;
  openedByName: string;
  closedAt: string;
  closedByName: string;
  openingCents: number;
  expectedCashCents: number | null;
  countedCashCents: number | null;
  differenceCents: number | null;
  notes: string | null;
  reopenedAt: string | null;
}

export interface FinanceReport {
  period: ReportPeriod;
  costs: { totalCents: number; byCategory: { categoryId: string | null; name: string; count: number; amountCents: number }[] } | null;
  fees: { totalCents: number; byMethod: MethodRow[] } | null;
  closings: CashClosingRow[];
}

export interface TeamPerformance {
  period: ReportPeriod;
  items: { userId: string; name: string; roleName: string; active: boolean; salesCount: number; salesTotalCents: number; averageTicketCents: number; completedOrders: number }[];
}

export interface AuditPage {
  items: AuditEntry[];
  total: number;
}
