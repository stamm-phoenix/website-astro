import { test, expect } from './fixtures';

test('leere Schuljahres- und Gruppenordner ohne Dateien erstellen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/leitendenbereich/fotos#ansicht=hochladen&ziel=Gruppenstunden');
  const name = page.getByLabel('Neuer Ordner darin');
  await name.fill('Schuljahr 2027-28');
  await page.getByRole('button', { name: 'Ordner erstellen', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'erstellt und geöffnet' })).toContainText(
    'Schuljahr 2027-28'
  );
  await expect(name).toHaveValue('');
  await name.fill('Wölflinge');
  await page.getByRole('button', { name: 'Ordner erstellen', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'erstellt und geöffnet' })).toContainText(
    'Wölflinge'
  );
  const response = await page.request.get(
    '/api/intern/fotos/ordner?pfad=Gruppenstunden/Schuljahr%202027-28'
  );
  expect((await response.json()).folders).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'Wölflinge' })])
  );
  await page.screenshot({ path: 'test-results/foto-ordner-nachher.png', fullPage: true });
});

test('Fehler erhält den Ordnernamen für einen neuen Versuch', async ({ page }) => {
  await page.goto('/leitendenbereich/fotos#ansicht=hochladen&ziel=Gruppenstunden');
  await page.route('**/api/intern/fotos/ziel', (route) =>
    route.request().method() === 'POST' ? route.abort() : route.continue()
  );
  await page.getByLabel('Neuer Ordner darin').fill('Neuer Ordner');
  await page.getByRole('button', { name: 'Ordner erstellen', exact: true }).click();
  await expect(page.getByRole('alert').last()).toBeVisible();
  await expect(page.getByLabel('Neuer Ordner darin')).toHaveValue('Neuer Ordner');
  await page.unroute('**/api/intern/fotos/ziel');
  await page.getByRole('button', { name: 'Ordner erstellen', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'erstellt und geöffnet' })).toBeVisible();
});
