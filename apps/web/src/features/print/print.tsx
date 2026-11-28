import type { PrintSize } from '@loja/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils.ts';

const PAGE_RULES: Record<PrintSize, string> = {
  '80mm': '@page { size: 80mm auto; margin: 3mm; }',
  '58mm': '@page { size: 58mm auto; margin: 2mm; }',
  A4: '@page { size: A4; margin: 14mm; }',
};

export const PRINT_WIDTHS: Record<PrintSize, string> = { '80mm': 'w-[74mm]', '58mm': 'w-[54mm]', A4: 'w-full max-w-[180mm]' };

export function printNow(size: PrintSize) {
  const style = document.createElement('style');
  style.dataset.print = 'page';
  style.textContent = PAGE_RULES[size];
  document.head.appendChild(style);
  document.body.classList.add('printing');
  const cleanup = () => {
    document.body.classList.remove('printing');
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  window.setTimeout(cleanup, 1000);
}

export function PrintPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const element = document.createElement('div');
    element.className = 'print-root';
    document.body.appendChild(element);
    setTarget(element);
    return () => element.remove();
  }, []);
  return target ? createPortal(children, target) : null;
}

export function PaperPreview({ size, children, className }: { size: PrintSize; children: ReactNode; className?: string }) {
  return (
    <div className={cn('mx-auto overflow-hidden rounded-md bg-white p-3 text-black shadow-inner', size === 'A4' ? 'max-w-[640px]' : size === '80mm' ? 'max-w-[320px]' : 'max-w-[240px]', className)}>
      {children}
    </div>
  );
}

export function PrintSizePicker({ value, onChange }: { value: PrintSize; onChange(size: PrintSize): void }) {
  return (
    <div role="radiogroup" aria-label="Tamanho do papel" className="inline-flex rounded-md border border-border p-0.5">
      {(['80mm', '58mm', 'A4'] as const).map((size) => (
        <button
          key={size}
          type="button"
          role="radio"
          aria-checked={value === size}
          onClick={() => onChange(size)}
          className={cn('rounded px-2.5 py-1 text-xs font-medium', value === size ? 'bg-surface-3 text-text' : 'text-muted hover:text-text')}
        >
          {size === 'A4' ? 'A4' : size.replace('mm', ' mm')}
        </button>
      ))}
    </div>
  );
}
