import { expect, test } from '@playwright/test';
import { login, money } from './helpers.ts';

test('abrir caixa, vender com troco e fechar sem diferença', async ({ page }) => {
  await login(page, 'ana@loja.test');

  await page.goto('/caixa');
  await expect(page.getByRole('heading', { name: 'Caixa fechado' })).toBeVisible();
  await page.getByLabel('Valor de abertura (troco na gaveta)').fill('10000');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByRole('button', { name: 'Fechar caixa' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Aberto/ }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Vender' }).first().click();
  const search = page.getByRole('combobox', { name: 'Buscar produto ou código de barras' });
  await expect(search).toBeFocused();
  await search.fill('7891000300032');
  await search.press('Enter');
  await expect(page.getByRole('list', { name: 'Itens do carrinho' })).toContainText('Cabo USB-C para USB-C 1 m');

  await search.fill('Película 3D iPhone');
  await page.getByRole('option', { name: /Película 3D iPhone 13\/14/ }).click();
  await page.getByRole('button', { name: 'Aumentar Cabo USB-C para USB-C 1 m' }).click();
  await expect(page.getByRole('list', { name: 'Itens do carrinho' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByText(money('89,80')).first()).toBeVisible();

  await page.keyboard.press('F10');
  const payment = page.getByRole('dialog', { name: 'Pagamento' });
  await expect(payment).toBeVisible();
  const confirm = payment.getByRole('button', { name: /Confirmar venda/ });
  await expect(confirm).toBeDisabled();

  await payment.getByRole('button', { name: 'Pix' }).click();
  await payment.getByLabel('Valor desta forma').fill('3980');
  await expect(payment.getByText('Falta pagar').locator('..')).toContainText('50,00');
  await expect(confirm).toBeDisabled();

  await payment.getByRole('button', { name: 'Dinheiro' }).click();
  await payment.getByLabel('Valor entregue pelo cliente').fill('10000');
  await expect(payment.getByText('Troco', { exact: true }).locator('..')).toContainText('50,00');
  await expect(confirm).toBeEnabled();
  await confirm.click();

  const receipt = page.getByRole('dialog', { name: /Comprovante/ });
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('Cabo USB-C para USB-C 1 m');
  await expect(receipt).toContainText('89,80');
  await receipt.getByRole('button', { name: 'Nova venda' }).click();
  await expect(page.getByText('Carrinho vazio')).toBeVisible();

  await page.goto('/caixa');
  await expect(page.getByText('Recebimento de venda').first()).toBeVisible();
  await page.getByRole('button', { name: 'Fechar caixa' }).click();
  const close = page.getByRole('dialog', { name: 'Fechar caixa' });
  await expect(close.getByRole('row', { name: /Dinheiro na gaveta/ })).toContainText('150,00');
  await expect(close.getByRole('row', { name: /^Pix/ })).toContainText('39,80');
  await close.getByLabel('Dinheiro contado na gaveta').fill('15000');
  await expect(close.getByRole('status')).toContainText('Bateu certinho');
  await close.getByRole('button', { name: 'Fechar caixa' }).click();

  await expect(page.getByRole('heading', { name: 'Caixa fechado' })).toBeVisible();
  await page.getByRole('tab', { name: 'Histórico de caixas' }).click();
  await expect(page.getByRole('row').nth(1)).toContainText('150,00');
});
