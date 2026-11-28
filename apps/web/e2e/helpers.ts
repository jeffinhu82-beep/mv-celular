import { expect, type Page } from '@playwright/test';

export const SEED_PASSWORD = 'loja12345';

export async function login(page: Page, user: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail ou usuário').fill(user);
  await page.getByLabel('Senha').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('navigation').first()).toBeVisible();
}

export const money = (text: string) => new RegExp(`R\\$\\s?${text.replace('.', '\\.')}`);
