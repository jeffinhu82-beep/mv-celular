import { dayKey, type PeriodKind } from '@loja/shared';
import { Segmented } from '@/components/ui/controls.tsx';
import { Input } from '@/components/ui/input.tsx';

export interface PeriodValue {
  kind: PeriodKind;
  from?: string;
  to?: string;
}

const OPTIONS = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'month', label: 'Este mês' },
  { value: 'range', label: 'Intervalo' },
] as const;

const KINDS: readonly string[] = OPTIONS.map((option) => option.value);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function periodQuery(value: PeriodValue): Record<string, string | undefined> {
  return value.kind === 'range' ? { period: 'range', from: value.from, to: value.to } : { period: value.kind };
}

export function readPeriod(params: URLSearchParams, fallback: PeriodKind): PeriodValue {
  const kind = params.get('period');
  if (!kind || !KINDS.includes(kind)) return { kind: fallback };
  if (kind !== 'range') return { kind: kind as PeriodKind };
  const today = dayKey(new Date());
  const from = params.get('from');
  const to = params.get('to');
  return { kind: 'range', from: from && DAY_KEY.test(from) ? from : today, to: to && DAY_KEY.test(to) ? to : today };
}

export function PeriodPicker({ value, onChange }: { value: PeriodValue; onChange(value: PeriodValue): void }) {
  const today = dayKey(new Date());
  const from = value.from ?? today;
  const to = value.to ?? today;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label="Período"
        value={value.kind}
        options={OPTIONS}
        onChange={(kind) => onChange(kind === 'range' ? { kind, from, to } : { kind })}
      />
      {value.kind === 'range' && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="Data inicial"
            value={from}
            max={today}
            onChange={(event) => {
              const next = event.target.value;
              if (DAY_KEY.test(next)) onChange({ kind: 'range', from: next, to: next > to ? next : to });
            }}
            className="w-auto"
          />
          <span className="text-sm text-muted">até</span>
          <Input
            type="date"
            aria-label="Data final"
            value={to}
            min={from}
            max={today}
            onChange={(event) => {
              const next = event.target.value;
              if (DAY_KEY.test(next)) onChange({ kind: 'range', from: next < from ? next : from, to: next });
            }}
            className="w-auto"
          />
        </div>
      )}
    </div>
  );
}
