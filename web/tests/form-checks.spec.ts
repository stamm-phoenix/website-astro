import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('check controls have a large clickable row and follow the dark theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/leitendenbereich/belege');
  const check = page.getByRole('checkbox', { name: 'Nur meine Belege' });
  await expect(check).toBeEnabled();
  const size = await check.boundingBox();
  expect(size?.width).toBeGreaterThanOrEqual(24);
  expect(size?.height).toBeGreaterThanOrEqual(24);
  const row = check.locator('..');
  expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await row.click();
  await expect(check).toBeChecked();
  await expect(check).toHaveCSS('color-scheme', 'dark');
  await expectNoHorizontalOverflow(page);
});
