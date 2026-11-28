import { describe, expect, it } from 'vitest';
import {
  customerSchema,
  dayKey,
  formatCsvDecimal,
  formatCsvMoney,
  formatDuration,
  formatMoney,
  formatPhoneBR,
  formatSequence,
  hourOf,
  isValidCnpj,
  isValidCpf,
  listDayKeys,
  normalizePhoneBR,
  parseMoneyInput,
  parsePercentToBps,
  renderTemplate,
  resolvePeriod,
  whatsappLink,
  DEFAULT_TEMPLATES,
} from '../src/index.ts';

describe('período em America/Sao_Paulo', () => {
  it('hoje começa à meia-noite local (03:00 UTC)', () => {
    const now = new Date('2026-11-26T02:30:00Z');
    const range = resolvePeriod('today', now);
    expect(range.start.toISOString()).toBe('2026-11-25T03:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-11-26T03:00:00.000Z');
    expect(dayKey(now)).toBe('2026-11-25');
    expect(hourOf(now)).toBe(23);
  });

  it('ontem, mês e intervalo', () => {
    const now = new Date('2026-11-26T15:00:00Z');
    expect(resolvePeriod('yesterday', now).start.toISOString()).toBe('2026-11-25T03:00:00.000Z');
    const month = resolvePeriod('month', now);
    expect(month.start.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(month.end.toISOString()).toBe('2026-12-01T03:00:00.000Z');
    const range = resolvePeriod('range', now, { from: '2026-11-10', to: '2026-11-12' });
    expect(range.start.toISOString()).toBe('2026-11-10T03:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-11-13T03:00:00.000Z');
    expect(listDayKeys(range)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
  });

  it('virada de ano', () => {
    const range = resolvePeriod('month', new Date('2026-12-15T12:00:00Z'));
    expect(range.end.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });
});

describe('formatos', () => {
  it('moeda com sinal explícito', () => {
    expect(formatMoney(123456)).toBe('R$ 1.234,56');
    expect(formatMoney(-500)).toBe('−R$ 5,00');
    expect(formatMoney(0)).toBe('R$ 0,00');
  });

  it('lê valores digitados', () => {
    expect(parseMoneyInput('1.234,56')).toBe(123456);
    expect(parseMoneyInput('R$ 50')).toBe(5000);
    expect(parseMoneyInput('0,5')).toBe(50);
    expect(parseMoneyInput('10.5')).toBe(1050);
    expect(parsePercentToBps('4,99')).toBe(499);
  });

  it('CSV usa número puro com vírgula decimal', () => {
    expect(formatCsvMoney(123456)).toBe('1234,56');
    expect(formatCsvMoney(-1250)).toBe('-12,50');
    expect(formatCsvMoney(-5)).toBe('-0,05');
    expect(formatCsvMoney(0)).toBe('0,00');
    expect(formatCsvMoney(null)).toBe('');
    expect(formatCsvDecimal(26.5)).toBe('26,5');
    expect(formatCsvDecimal(null)).toBe('');
  });

  it('duração curta e legível', () => {
    expect(formatDuration(45 * 60000)).toBe('45 min');
    expect(formatDuration(5 * 3600000)).toBe('5 h');
    expect(formatDuration(90 * 60000)).toBe('1 h 30 min');
    expect(formatDuration(26.5 * 3600000)).toBe('1 d 2 h');
    expect(formatDuration(48 * 3600000)).toBe('2 d');
    expect(formatDuration(null)).toBe('—');
  });

  it('numeração sequencial', () => {
    expect(formatSequence('V', 123)).toBe('V-000123');
    expect(formatSequence('OS', 45)).toBe('OS-000045');
  });
});

describe('Brasil', () => {
  it('telefone em E.164', () => {
    expect(normalizePhoneBR('(48) 99999-9999')).toBe('+5548999999999');
    expect(normalizePhoneBR('+55 48 3222-1111')).toBe('+554832221111');
    expect(normalizePhoneBR('9999')).toBeNull();
    expect(formatPhoneBR('+5548999999999')).toBe('(48) 99999-9999');
  });

  it('CPF e CNPJ', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
  });

  it('schema de cliente normaliza telefone e valida CPF', () => {
    const parsed = customerSchema.parse({ name: 'Ana', phone: '(48) 98888-7777', cpf: '529.982.247-25' });
    expect(parsed.phone).toBe('+5548988887777');
    expect(parsed.cpf).toBe('52998224725');
    expect(customerSchema.safeParse({ name: 'Ana', phone: '48988887777', cpf: '123' }).success).toBe(false);
  });

  it('link do WhatsApp com mensagem codificada', () => {
    const message = renderTemplate(DEFAULT_TEMPLATES.ready, {
      primeiro_nome: 'Ana',
      aparelho: 'iPhone 13',
      valor_restante: 'R$ 200,00',
      endereco_loja: 'Rua A, 1',
      loja: 'Loja',
    });
    expect(message).toContain('Seu iPhone 13 está pronto');
    const link = whatsappLink('+5548999999999', message)!;
    expect(link.startsWith('https://wa.me/5548999999999?text=')).toBe(true);
    expect(decodeURIComponent(link.split('text=')[1]!)).toBe(message);
  });
});
