import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import { login } from './helpers.ts';

async function csvOf(page: Page, button: string): Promise<{ name: string; text: string }> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  const download: Download = await downloading;
  return { name: download.suggestedFilename(), text: await readFile(await download.path(), 'utf8') };
}

test('histórico exporta as vendas do filtro e relatórios listam os itens vendidos', async ({ page }) => {
  await login(page, 'carlos@loja.test');

  const lookup = await page.request.get('/api/products/lookup?code=7891000300032');
  const cable = (await lookup.json()).product as { id: string; name: string; priceCents: number };
  expect((await page.request.post('/api/cash/open', { data: { openingCents: 0 } })).ok()).toBe(true);
  const sale = await page.request.post('/api/sales', {
    data: {
      items: [{ productId: cable.id, name: cable.name, qty: 2, unitPriceCents: cable.priceCents }],
      payments: [{ method: 'pix', amountCents: cable.priceCents * 2 }],
    },
  });
  expect(sale.ok(), await sale.text()).toBe(true);
  const { number } = (await sale.json()) as { number: string };
  expect((await page.request.post('/api/cash/close', { data: { countedCashCents: 0 } })).ok()).toBe(true);

  await page.goto('/vendas');
  await expect(page.getByRole('row', { name: new RegExp(number) })).toBeVisible();
  const sales = await csvOf(page, 'Exportar vendas em CSV');
  expect(sales.name).toMatch(/^vendas_\d{4}-\d{2}-\d{2}_a_\d{4}-\d{2}-\d{2}\.csv$/);
  const [header, ...lines] = sales.text.replace('\uFEFF', '').trim().split('\r\n');
  expect(header).toBe('Venda;Data;Situação;Origem;OS;Cliente;Vendedor;Formas de pagamento;Itens;Desconto (R$);Total (R$);A receber (R$)');
  expect(lines.find((line) => line.startsWith(`${number};`))).toMatch(/;Concluída;Balcão;;Consumidor;Carlos Menezes;Pix;2x Cabo USB-C para USB-C 1 m;0,00;59,80;0,00$/);

  await page.getByRole('link', { name: 'Relatórios' }).first().click();
  await page.getByRole('tab', { name: 'Itens vendidos' }).click();
  await expect(page).toHaveURL(/aba=itens/);
  await page.getByRole('searchbox', { name: 'Buscar item vendido' }).fill('cabo usb-c para');
  const row = page.getByRole('row', { name: new RegExp(number) });
  await expect(row).toContainText('Cabo USB-C para USB-C 1 m');
  const items = await csvOf(page, 'Exportar itens vendidos em CSV');
  expect(items.name).toMatch(/^itens-vendidos_\d{4}-\d{2}-\d{2}_a_\d{4}-\d{2}-\d{2}\.csv$/);
  const itemLines = items.text.replace('\uFEFF', '').trim().split('\r\n').slice(1);
  expect(itemLines.every((line) => line.includes('Cabo USB-C para USB-C 1 m'))).toBe(true);
  expect(itemLines.find((line) => line.startsWith(`${number};`))).toMatch(/;;Cabo USB-C para USB-C 1 m;2;29,90;0,00;59,80;Carlos Menezes;Consumidor$/);

  await row.click();
  await expect(page).toHaveURL(/\/vendas\/[0-9a-f-]{36}$/);
});
