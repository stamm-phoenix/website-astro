import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures';

test('the Kostenstellen of a year download as a PDF', async ({ page }) => {
  await page.goto('/leitendenbereich/kostenstellen');
  const jahr = page.getByLabel('Buchungen im Jahr');
  const year = await jahr.locator('option').nth(1).textContent();
  await jahr.selectOption({ label: year! });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF herunterladen', exact: true }).click();
  const pdf = await download;
  expect(pdf.suggestedFilename()).toBe(`Kostenstellen ${year}.pdf`);
  expect((await readFile(await pdf.path())).subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.getByText('PDF heruntergeladen.').first()).toBeVisible();
});
