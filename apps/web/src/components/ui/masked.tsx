import { formatCentsInput, maskPhoneInput, onlyDigits, parsePercentToBps } from '@loja/shared';
import { Search, X } from 'lucide-react';
import { forwardRef, useEffect, useState, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils.ts';
import { Input } from './input.tsx';

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>;

export const MoneyInput = forwardRef<HTMLInputElement, BaseProps & { value: number; onValueChange(cents: number): void; max?: number }>(function MoneyInput(
  { value, onValueChange, className, max, ...props },
  ref,
) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">R$</span>
      <Input
        ref={ref}
        inputMode="numeric"
        autoComplete="off"
        className={cn('num pl-9 text-right', className)}
        value={formatCentsInput(value || 0)}
        onChange={(event) => {
          const digits = onlyDigits(event.target.value).replace(/^0+/, '').slice(0, 11);
          let cents = Number(digits || '0');
          if (max !== undefined && cents > max) cents = max;
          onValueChange(cents);
        }}
        onFocus={(event) => {
          const target = event.currentTarget;
          requestAnimationFrame(() => target.setSelectionRange(target.value.length, target.value.length));
        }}
        {...props}
      />
    </div>
  );
});

export const PercentInput = forwardRef<HTMLInputElement, BaseProps & { value: number; max?: number; inputClassName?: string; onValueChange(bps: number): void }>(function PercentInput(
  { value, onValueChange, className, inputClassName, max = 10000, ...props },
  ref,
) {
  const [text, setText] = useState(() => (value / 100).toFixed(2).replace('.', ','));
  useEffect(() => {
    if (parsePercentToBps(text) !== value) setText((value / 100).toFixed(2).replace('.', ','));
  }, [value]);
  return (
    <div className={cn('relative', className)}>
      <Input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        className={cn('num w-full pr-8 text-right', inputClassName)}
        value={text}
        onChange={(event) => {
          const next = event.target.value.replace(/[^\d,.]/g, '');
          setText(next);
          onValueChange(Math.min(max, Math.max(0, parsePercentToBps(next))));
        }}
        onBlur={() => setText((value / 100).toFixed(2).replace('.', ','))}
        {...props}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">%</span>
    </div>
  );
});

export const PhoneInput = forwardRef<HTMLInputElement, BaseProps & { value: string; onValueChange(value: string): void }>(function PhoneInput(
  { value, onValueChange, ...props },
  ref,
) {
  const display = value.startsWith('+55') ? maskPhoneInput(value.slice(3)) : maskPhoneInput(value);
  return (
    <Input
      ref={ref}
      type="tel"
      inputMode="tel"
      autoComplete="tel-national"
      placeholder="(48) 99999-9999"
      value={display}
      onChange={(event) => onValueChange(maskPhoneInput(event.target.value))}
      {...props}
    />
  );
});

export function maskCpf(value: string): string {
  const digits = onlyDigits(value).slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

export function maskDocument(value: string): string {
  const digits = onlyDigits(value).slice(0, 14);
  if (digits.length <= 11) return maskCpf(digits);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export const SearchInput = forwardRef<HTMLInputElement, BaseProps & { value: string; onValueChange(value: string): void }>(function SearchInput(
  { value, onValueChange, className, placeholder = 'Buscar…', ...props },
  ref,
) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <Input
        ref={ref}
        type="search"
        className="pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        {...props}
      />
      {value && (
        <button type="button" onClick={() => onValueChange('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted hover:text-text" aria-label="Limpar busca">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
});
