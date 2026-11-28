import { STORE_TIME_ZONE } from './period.ts';

const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const decimalFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const formatted = moneyFormatter.format(Math.abs(cents) / 100).replace(/ /g, ' ');
  return cents < 0 ? `−${formatted}` : formatted;
}

export function formatSignedMoney(cents: number): string {
  if (cents > 0) return `+${formatMoney(cents)}`;
  return formatMoney(cents);
}

export function formatCentsInput(cents: number): string {
  return decimalFormatter.format(cents / 100);
}

export function parseMoneyInput(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Math.round(value * 100);
  const cleaned = value.replace(/[^\d,.-]/g, '').trim();
  if (!cleaned) return 0;
  const negative = cleaned.startsWith('-');
  const unsigned = cleaned.replace(/-/g, '');
  const lastComma = unsigned.lastIndexOf(',');
  const lastDot = unsigned.lastIndexOf('.');
  let integerPart = unsigned;
  let fractionPart = '';
  const separatorIndex = Math.max(lastComma, lastDot);
  if (separatorIndex >= 0 && unsigned.length - separatorIndex - 1 <= 2) {
    integerPart = unsigned.slice(0, separatorIndex);
    fractionPart = unsigned.slice(separatorIndex + 1);
  }
  const digits = integerPart.replace(/[.,]/g, '') || '0';
  const cents = Number(digits) * 100 + Number((fractionPart + '00').slice(0, 2));
  return negative ? -cents : cents;
}

export function formatBps(bps: number): string {
  return `${decimalFormatter.format(bps / 100)}%`;
}

export function parsePercentToBps(value: string | number): number {
  if (typeof value === 'number') return Math.round(value * 100);
  const cleaned = value.replace('%', '').trim().replace(/\./g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: STORE_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: STORE_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: STORE_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: Date | string | null | undefined): string {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : '—';
}

export function formatDateTime(value: Date | string | null | undefined): string {
  const date = toDate(value);
  return date ? dateTimeFormatter.format(date).replace(',', '') : '—';
}

export function formatTime(value: Date | string | null | undefined): string {
  const date = toDate(value);
  return date ? timeFormatter.format(date) : '—';
}

export function formatRelativeDays(value: Date | string | null | undefined, now = new Date()): string {
  const date = toDate(value);
  if (!date) return '—';
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'há 1 dia' : `há ${days} dias`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 > 0 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 > 0 ? `${days} d ${hours % 24} h` : `${days} d`;
}

export function formatCsvMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

export function formatCsvDecimal(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return value.toFixed(digits).replace('.', ',');
}

export function formatSequence(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(6, '0')}`;
}

export function onlyDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}
