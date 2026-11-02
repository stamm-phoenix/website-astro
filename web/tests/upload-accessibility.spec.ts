import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test.use({ viewport: { width: 390, height: 844 } });

test('file selection has visible keyboard focus and edit dialogs contain scrolling', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/downloads');
  const input = page.locator('input[type=file]').first();
  await expect(input).toBeAttached();
  await page.keyboard.press('Tab');
  await input.focus();
  const label = input.locator('..');
  await expect(label).toHaveCSS('outline-style', 'solid');
  await expect(label).toHaveCSS('outline-width', '3px');
  await expectNoHorizontalOverflow(page);

  await page
    .getByRole('button', { name: /^Bearbeiten/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Datei bearbeiten' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('form > .overflow-y-auto')).toHaveCSS(
    'overscroll-behavior-y',
    'contain'
  );
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
});

test('participant status filters have phone-sized targets', async ({ page }) => {
  await page.goto('/leitendenbereich/aktionen/aktion?id=evt_Georgsfest');
  const status = page.getByRole('group', { name: 'Status', exact: true });
  await expect(status).toBeVisible();
  for (const button of await status.getByRole('button').all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalOverflow(page);
});
