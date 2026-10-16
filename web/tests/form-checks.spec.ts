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

test('the own-task switch keeps its full track and can still be toggled by keyboard', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/aufgaben');
  await page.getByText('Filter (0 aktiv)', { exact: true }).click();
  const own = page.getByRole('switch', { name: 'Nur mir zugewiesen' });
  await expect(own).toBeVisible();
  expect((await own.boundingBox())?.width).toBeGreaterThanOrEqual(44);
  await own.focus();
  await page.keyboard.press('Space');
  await expect(own).toBeChecked();
  await expect(page.getByText('Filter (1 aktiv)', { exact: true })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(own).not.toBeChecked();
});

test('participant checkboxes keep the shared size in the mobile cards', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'The old size override only applies to mobile cards.');
  await page.goto('/leitendenbereich/abrechnung/evt_Sola26');
  await page.getByRole('tab', { name: /Teilnehmende/ }).click();
  const check = page.locator('.tn-check-target input').first();
  await expect(check).toBeVisible();
  const size = await check.boundingBox();
  expect(size?.width).toBeGreaterThanOrEqual(24);
  expect(size?.height).toBeGreaterThanOrEqual(24);
  expect((await check.locator('..').boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await check.uncheck();
  await expect(check).not.toBeChecked();
  await expectNoHorizontalOverflow(page);
});
