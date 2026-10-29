import type { Page } from '@playwright/test';
import { expect, expectNoHorizontalOverflow } from './fixtures';

/** Creates a Planung over the start page and the confirmation link the mock shows. */
export async function anlegen(page: Page, name: string): Promise<void> {
  await page.goto('/essensplanung');
  await expect(page.getByRole('heading', { name: 'Neue Planung anlegen' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByLabel('Name der Planung').fill(name);
  await page.getByLabel('Erster Tag').fill('2027-08-01');
  await page.getByLabel('Letzter Tag').fill('2027-08-02');
  await page.getByLabel('Dein Name').fill('Kim Küche');
  await page.getByLabel('Deine Mailadresse', { exact: true }).first().fill('kim@stamm-phoenix.de');
  await page.getByRole('button', { name: 'Link zum Anlegen schicken' }).click();
  await expect(page.getByRole('status').getByText(/Fast geschafft/)).toBeVisible();
  await page.getByRole('link', { name: 'Planung bestätigen' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}
