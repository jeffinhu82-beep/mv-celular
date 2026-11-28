import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { login } from './helpers.ts';

test('relatórios trocam de aba, exportam CSV e a auditoria mostra quem entrou', async ({ page }) => {
  await login(page, 'carlos@loja.test');

  await page.goto('/caixa');
  await page.getByLabel('Valor de abertura (troco na gaveta)').fill('5000');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await page.getByRole('button', { name: 'Fechar caixa' }).click();
  const close = page.getByRole('dialog', { name: 'Fechar caixa' });
  await close.getByLabel('Dinheiro contado na gaveta').fill('5000');
  await expect(close.getByRole('status')).toContainText('Bateu certinho');
  await close.getByRole('button', { name: 'Fechar caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Caixa fechado' })).toBeVisible();

  await page.getByRole('link', { name: 'Relatórios' }).first().click();
  await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportar recebido por forma em CSV' })).toBeVisible();

  await page.getByRole('tab', { name: 'Ordens de serviço' }).click();
  await expect(page).toHaveURL(/aba=os/);
  await expect(page.getByRole('button', { name: 'Exportar OS por técnico em CSV' })).toBeVisible();

  await page.getByRole('tab', { name: 'Financeiro' }).click();
  await expect(page).toHaveURL(/aba=financeiro/);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar fechamentos de caixa em CSV' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^fechamentos-de-caixa_\d{4}-\d{2}-\d{2}(_a_\d{4}-\d{2}-\d{2})?\.csv$/);
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv.startsWith('\uFEFFAbertura;Aberto por;Fechamento;Fechado por;Fundo (R$);Esperado (R$);Contado (R$);Diferença (R$);Observação\r\n')).toBe(true);
  expect(csv).toContain(';Carlos');
  expect(csv).toContain(';50,00;50,00;50,00;0,00;');

  await page.getByRole('link', { name: 'Auditoria' }).first().click();
  await expect(page.getByRole('heading', { name: 'Auditoria' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Tipo de ação' }).selectOption({ label: 'Acesso' });
  await expect(page).toHaveURL(/acao=auth\./);
  const row = page.getByRole('row', { name: /Entrou no sistema/ }).first();
  await expect(row).toBeVisible();
  await row.click();
  const details = page.getByRole('dialog', { name: 'Entrou no sistema' });
  await expect(details).toBeVisible();
  await expect(details.getByText('Quem fez')).toBeVisible();
});

test('caixa não vê relatórios nem auditoria', async ({ page }) => {
  await login(page, 'ana@loja.test');
  await expect(page.getByRole('link', { name: 'Relatórios' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Auditoria' })).toHaveCount(0);

  await page.goto('/relatorios');
  await expect(page.getByText('Você não tem acesso a esta tela')).toBeVisible();
  await page.goto('/auditoria');
  await expect(page.getByText('Você não tem acesso a esta tela')).toBeVisible();
});
