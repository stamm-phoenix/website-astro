import { test, expect } from './fixtures';

// The choice between the formatting editor and the Markdown field is saved per person (#320).

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/__mock/einstellungen/reset');
});

test('the formatting editor is the default and the choice of Markdown is kept on every device', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde Voreinstellung');
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  const region = page.getByRole('region', { name: /^2\. / });
  await expect(region.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible();
  await expect(region.locator('textarea')).toHaveCount(0);

  const modus = page.getByRole('group', { name: 'Texte schreiben als' });
  await modus.getByRole('button', { name: 'Markdown' }).click();
  await expect(region.locator('textarea')).toHaveCount(1);
  await expect(region.getByRole('toolbar', { name: 'Formatierung' })).toHaveCount(0);
  // Saved on the server: another load, as on another device, starts with Markdown
  await expect
    .poll(async () => await (await page.request.get('/api/intern/einstellungen')).json())
    .toEqual({ settings: { protokollText: 'markdown' } });
  await page.reload();
  await expect(region.locator('textarea')).toHaveCount(1);
  await expect(modus.getByRole('button', { name: 'Markdown' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('a choice that cannot be saved still applies to the open page and says so', async ({
  page,
}) => {
  await page.goto('/leitendenbereich/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll schreiben' }).click();
  await page.getByLabel('Titel').fill('Leitendenrunde Wahl ohne Server');
  await page.getByRole('button', { name: 'Anlegen und schreiben' }).click();
  const region = page.getByRole('region', { name: /^2\. / });
  await expect(region.getByRole('toolbar', { name: 'Formatierung' })).toBeVisible();

  await page.route('**/api/intern/einstellungen', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 500, json: {} }) : route.fallback()
  );
  await page
    .getByRole('group', { name: 'Texte schreiben als' })
    .getByRole('button', { name: 'Markdown' })
    .click();
  await expect(region.locator('textarea')).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: 'nicht gespeichert' })).toBeVisible();
});
