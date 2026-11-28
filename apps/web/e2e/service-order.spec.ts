import { expect, test, type Page } from '@playwright/test';
import { login, money } from './helpers.ts';

async function ensureCashOpen(page: Page) {
  await page.goto('/caixa');
  const openButton = page.getByRole('button', { name: 'Abrir caixa' });
  const closeButton = page.getByRole('button', { name: 'Fechar caixa' });
  await expect(openButton.or(closeButton).first()).toBeVisible();
  if (await openButton.isVisible()) {
    await page.getByLabel('Valor de abertura (troco na gaveta)').fill('5000');
    await openButton.click();
    await expect(closeButton).toBeVisible();
  }
}

test('OS de Recebido a Entregue com orçamento, aprovação, aviso de pronto e Receber e entregar', async ({ page }) => {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.assign(window, { __opened: opened });
    window.open = (url?: string | URL) => {
      opened.push(String(url));
      return null;
    };
  });
  await login(page, 'admin');
  await ensureCashOpen(page);

  await page.goto('/os');
  await page.getByRole('button', { name: 'Nova OS' }).click();
  const form = page.getByRole('dialog', { name: 'Nova OS' });
  await form.getByRole('combobox', { name: 'Buscar cliente' }).fill('Mariana');
  await form.getByRole('option', { name: /Mariana Alves/ }).click();
  await form.getByLabel('Marca').fill('Samsung');
  await form.getByLabel('Modelo').fill('Galaxy A32');
  await form.getByLabel('Defeito relatado').fill('Tela trincada depois de uma queda.');
  await form.getByRole('button', { name: 'Abrir OS' }).click();

  const entryPrint = page.getByRole('dialog', { name: /Comprovante de entrada · OS-/ });
  await expect(entryPrint).toBeVisible();
  const titleId = await entryPrint.getAttribute('aria-labelledby');
  const number = (await page.locator(`[id="${titleId}"]`).textContent())?.match(/OS-\d+/)?.[0];
  expect(number).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(entryPrint).toBeHidden();

  const sheet = page.getByRole('dialog', { name: number! });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Recebido', { exact: true }).first()).toBeVisible();

  await sheet.getByRole('button', { name: 'Lançar' }).click();
  const quote = page.getByRole('dialog', { name: `Orçamento · ${number}` });
  await quote.getByRole('button', { name: 'Mão de obra' }).click();
  await quote.getByLabel('Preço unitário').fill('15000');
  await expect(quote.getByText(money('150,00')).first()).toBeVisible();
  await quote.getByRole('button', { name: 'Salvar orçamento' }).click();
  await expect(quote).toBeHidden();

  await sheet.getByRole('button', { name: 'Registrar resposta' }).click();
  const approval = page.getByRole('dialog', { name: 'Resposta do orçamento' });
  await approval.getByRole('button', { name: 'Registrar aprovação' }).click();
  await expect(approval).toBeHidden();
  await expect(sheet.getByText(/Aprovado por Mariana Alves/)).toBeVisible();

  await sheet.getByRole('button', { name: 'Editar' }).first().click();
  const edit = page.getByRole('dialog', { name: `Editar ${number}` });
  await edit.getByLabel('Diagnóstico').fill('Display trincado, troca do conjunto.');
  await edit.getByRole('button', { name: 'Salvar' }).click();
  await expect(edit).toBeHidden();

  await sheet.getByRole('button', { name: 'Mover para…' }).click();
  await page.getByRole('menuitem', { name: 'Pronto para retirada' }).click();
  const notice = page.getByRole('dialog', { name: 'Avisar o cliente?' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Abrir WhatsApp' }).click();
  await expect(notice).toBeHidden();
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened).toHaveLength(1);
  expect(opened[0]).toContain('https://wa.me/5548991234567');
  const message = decodeURIComponent(opened[0]!);
  expect(message).toContain('Samsung Galaxy A32 está pronto para retirada');
  expect(message).toMatch(money('150,00'));
  await expect(sheet.getByText('WhatsApp aberto').first()).toBeVisible();

  await sheet.getByRole('button', { name: 'Receber e entregar' }).click();
  const payment = page.getByRole('dialog', { name: `Receber e entregar · ${number}` });
  await expect(payment).toBeVisible();
  await payment.getByRole('button', { name: 'Pix' }).click();
  await expect(payment.getByLabel('Valor desta forma')).toHaveValue(/150,00/);
  await payment.getByRole('button', { name: /^Receber e entregar/ }).click();

  const receipt = page.getByRole('dialog', { name: /Comprovante V-/ });
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('Mão de obra');
  await expect(receipt).toContainText('150,00');
  await page.keyboard.press('Escape');

  await page.goto('/os?todas=1');
  const done = page.getByRole('region', { name: /^Entregue,/ });
  await expect(done.getByText(number!)).toBeVisible();
  await page.getByText(number!).first().click();
  const delivered = page.getByRole('dialog', { name: number! });
  await expect(delivered.getByText('Entregue', { exact: true }).first()).toBeVisible();
  await expect(delivered.getByText(/garantia até/)).toBeVisible();
});
