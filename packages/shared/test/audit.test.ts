import { describe, expect, it } from 'vitest';
import { auditDiff, auditRecordLabel, formatAuditValue } from '../src/index.ts';

describe('detalhe da auditoria', () => {
  it('formata valores pelo nome do campo', () => {
    expect(formatAuditValue('totalCents', 3000)).toBe(formatAuditValue('paidCents', 3000));
    expect(formatAuditValue('totalCents', 3000)).toMatch(/30,00/);
    expect(formatAuditValue('effectiveDiscountBps', 371)).toMatch(/3,71/);
    expect(formatAuditValue('active', false)).toBe('Não');
    expect(formatAuditValue('status', 'cancelled')).toBe('Cancelada');
    expect(formatAuditValue('channel', 'whatsapp')).toBe('WhatsApp');
    expect(formatAuditValue('email', null)).toBe('—');
    expect(formatAuditValue('role', { id: 'x', name: 'Técnico' })).toBe('Técnico');
    expect(formatAuditValue('items', [{ qty: 2, name: 'Película', unitPriceCents: 2500 }])).toMatch(/^2× Película \(R\$\s25,00\)$/);
    expect(formatAuditValue('permissions', ['report.view'])).toBe('Ver relatórios');
  });

  it('marca só o que mudou e separa permissões ganhas e perdidas', () => {
    const diff = auditDiff(
      { name: 'Técnico', permissions: ['os.edit', 'os.move'], discountLimitBps: 0 },
      { name: 'Técnico', permissions: ['os.edit', 'stock.manage'], discountLimitBps: 0 },
    );
    expect(diff.mode).toBe('change');
    expect(diff.fields.filter((field) => field.changed).map((field) => field.key)).toEqual(['permissions']);
    expect(diff.permissions).toEqual({ added: ['stock.manage'], removed: ['os.move'] });
  });

  it('campo que não veio no depois não conta como mudança', () => {
    const diff = auditDiff({ id: '1', order: 3, name: 'Pronto' }, { name: 'Pronto para retirada' });
    expect(diff.fields.filter((field) => field.changed).map((field) => field.key)).toEqual(['name']);
  });

  it('criação mostra os valores gravados sem o id', () => {
    const diff = auditDiff(null, { id: 'abc', openingCents: 20000 });
    expect(diff.mode).toBe('created');
    expect(diff.fields.map((field) => field.key)).toEqual(['openingCents']);
    expect(auditDiff(null, null).mode).toBe('empty');
  });

  it('registro usa o número do documento quando existe', () => {
    expect(auditRecordLabel('Sale', null, { number: 'V-000075' })).toBe('V-000075');
    expect(auditRecordLabel('Role', { name: 'Técnico' }, { name: 'Técnico' })).toBe('Perfil Técnico');
    expect(auditRecordLabel('CashSession', null, { openingCents: 1 })).toBe('Caixa');
  });
});
