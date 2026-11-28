import { auditActionLabel, auditDiff, auditFieldLabel, auditPermissionLabel, auditRecordLabel, formatAuditValue, formatDateTime, type AuditFieldChange } from '@loja/shared';
import { Minus, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import type { AuditEntry } from '@/lib/types.ts';
import { cn, plural } from '@/lib/utils.ts';

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-muted sm:w-32">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Value({ field, side }: { field: AuditFieldChange; side: 'before' | 'after' }) {
  const text = formatAuditValue(field.key, field[side]);
  return <span className={cn('break-words', text === '—' && 'text-muted')}>{text}</span>;
}

function PermissionList({ icon: Icon, title, keys, tone }: { icon: typeof Plus; title: string; keys: string[]; tone: 'success' | 'warning' }) {
  if (keys.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">{title}</p>
      <ul className="flex flex-col gap-1">
        {keys.map((key) => (
          <li key={key} className="flex items-start gap-2 text-sm">
            <Icon className={cn('mt-0.5 size-4 shrink-0', tone === 'success' ? 'text-success' : 'text-warning')} aria-hidden />
            {auditPermissionLabel(key)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FieldTable({ fields, twoSided }: { fields: AuditFieldChange[]; twoSided: boolean }) {
  return (
    <div className="relative overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
            <th scope="col" className="w-1/4 px-3 py-2 font-medium">
              Campo
            </th>
            {twoSided && (
              <th scope="col" className="px-3 py-2 font-medium">
                Antes
              </th>
            )}
            <th scope="col" className="px-3 py-2 font-medium">
              {twoSided ? 'Depois' : 'Valor'}
            </th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.key} className={cn('border-b border-border/60 align-top last:border-0', !field.changed && 'text-muted')}>
              <th scope="row" className="px-3 py-2 text-left font-normal text-muted">
                {auditFieldLabel(field.key)}
              </th>
              {twoSided && (
                <td className="px-3 py-2">
                  <Value field={field} side="before" />
                </td>
              )}
              <td className={cn('px-3 py-2', twoSided && field.changed && 'font-medium')}>
                <Value field={field} side={field.after === undefined && !twoSided ? 'before' : 'after'} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditDetailsDialog({ entry, onOpenChange }: { entry: AuditEntry | null; onOpenChange(open: boolean): void }) {
  const [showAll, setShowAll] = useState(false);
  const diff = entry ? auditDiff(entry.before, entry.after) : null;
  const tableFields = diff ? diff.fields.filter((field) => !(diff.permissions && field.key === 'permissions')) : [];
  const changed = tableFields.filter((field) => field.changed);
  const unchanged = tableFields.filter((field) => !field.changed);
  const visible = showAll ? tableFields : changed;

  return (
    <Dialog
      open={Boolean(entry)}
      onOpenChange={(open) => {
        if (!open) setShowAll(false);
        onOpenChange(open);
      }}
    >
      {entry && diff && (
        <DialogContent size="lg" title={auditActionLabel(entry.action)} description={formatDateTime(entry.createdAt)}>
          <dl className="mb-5 flex flex-col gap-2 text-sm">
            <Meta label="Quem fez">{entry.userName ?? <span className="text-muted">Sistema</span>}</Meta>
            {entry.approvedByName && <Meta label="Autorizado por">{entry.approvedByName}</Meta>}
            <Meta label="Registro">{auditRecordLabel(entry.entity, entry.before, entry.after)}</Meta>
            <Meta label="IP">{entry.ip ?? <span className="text-muted">—</span>}</Meta>
          </dl>

          {diff.mode === 'empty' && <p className="text-sm text-muted">Esta ação não grava detalhes além de quem, quando e de onde.</p>}

          {diff.permissions && (
            <div className="mb-4 flex flex-col gap-3 rounded-md border border-border p-3">
              <PermissionList icon={Plus} title="Permissões adicionadas" keys={diff.permissions.added} tone="success" />
              <PermissionList icon={Minus} title="Permissões removidas" keys={diff.permissions.removed} tone="warning" />
            </div>
          )}

          {diff.mode !== 'empty' && (visible.length > 0 || unchanged.length > 0) && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{diff.mode === 'change' ? 'O que mudou' : diff.mode === 'created' ? 'Dados registrados' : 'Dados antes da ação'}</h3>
              {visible.length > 0 ? (
                <FieldTable fields={visible} twoSided={diff.mode === 'change'} />
              ) : (
                <p className="text-sm text-muted">{diff.permissions ? 'Nenhum outro campo mudou.' : 'Nenhum campo mudou.'}</p>
              )}
              {diff.mode === 'change' && unchanged.length > 0 && (
                <Button variant="ghost" size="sm" className="-ml-2 self-start text-muted hover:text-text" onClick={() => setShowAll((value) => !value)}>
                  {showAll ? 'Mostrar só o que mudou' : `Mostrar ${plural(unchanged.length, 'campo sem mudança', 'campos sem mudança')}`}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
