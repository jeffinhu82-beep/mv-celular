export const STORE_TIME_ZONE = 'America/Sao_Paulo';

export type PeriodKind = 'today' | 'yesterday' | 'month' | 'range';

export interface PeriodRange {
  start: Date;
  end: Date;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function zonedParts(date: Date, timeZone = STORE_TIME_ZONE): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function zonedDateToUtc(
  year: number,
  month: number,
  day: number,
  timeZone = STORE_TIME_ZONE,
  hour = 0,
  minute = 0,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(new Date(guess), timeZone);
  const second = guess - offsetMs(new Date(first), timeZone);
  return new Date(second);
}

export function startOfDay(date: Date, timeZone = STORE_TIME_ZONE): Date {
  const p = zonedParts(date, timeZone);
  return zonedDateToUtc(p.year, p.month, p.day, timeZone);
}

export function addDays(date: Date, days: number, timeZone = STORE_TIME_ZONE): Date {
  const p = zonedParts(date, timeZone);
  return zonedDateToUtc(p.year, p.month, p.day + days, timeZone, p.hour, p.minute);
}

export function dayKey(date: Date, timeZone = STORE_TIME_ZONE): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function hourOf(date: Date, timeZone = STORE_TIME_ZONE): number {
  return zonedParts(date, timeZone).hour;
}

export function parseDayKey(key: string, timeZone = STORE_TIME_ZONE): Date {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) throw new Error(`Data inválida: ${key}`);
  return zonedDateToUtc(year, month, day, timeZone);
}

export function resolvePeriod(
  kind: PeriodKind,
  now: Date,
  custom?: { from?: string; to?: string },
  timeZone = STORE_TIME_ZONE,
): PeriodRange {
  const p = zonedParts(now, timeZone);
  switch (kind) {
    case 'today':
      return {
        start: zonedDateToUtc(p.year, p.month, p.day, timeZone),
        end: zonedDateToUtc(p.year, p.month, p.day + 1, timeZone),
      };
    case 'yesterday':
      return {
        start: zonedDateToUtc(p.year, p.month, p.day - 1, timeZone),
        end: zonedDateToUtc(p.year, p.month, p.day, timeZone),
      };
    case 'month':
      return {
        start: zonedDateToUtc(p.year, p.month, 1, timeZone),
        end: zonedDateToUtc(p.year, p.month + 1, 1, timeZone),
      };
    case 'range': {
      const from = custom?.from ? parseDayKey(custom.from, timeZone) : zonedDateToUtc(p.year, p.month, p.day, timeZone);
      const toStart = custom?.to ? parseDayKey(custom.to, timeZone) : from;
      return { start: from, end: addDays(toStart, 1, timeZone) };
    }
  }
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

export function listDayKeys(range: PeriodRange, timeZone = STORE_TIME_ZONE): string[] {
  const keys: string[] = [];
  let cursor = range.start;
  while (cursor < range.end && keys.length < 400) {
    keys.push(dayKey(cursor, timeZone));
    cursor = addDays(startOfDay(cursor, timeZone), 1, timeZone);
  }
  return keys;
}
