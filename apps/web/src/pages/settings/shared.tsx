import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/misc.tsx';

export function SettingsSection({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card className="mb-4">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      <div className="p-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>}
    </Card>
  );
}

export function SaveButton({ loading, dirty, form }: { loading: boolean; dirty: boolean; form?: string }) {
  return (
    <Button variant="primary" type="submit" form={form} loading={loading} disabled={!dirty}>
      {dirty ? 'Salvar alterações' : 'Salvo'}
    </Button>
  );
}
