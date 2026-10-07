import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('the Steuerung switches the staff modules and saves days', async ({ page }) => {
  await page.goto('/leitendenbereich');
  await page.locator('summary', { hasText: 'Nikolausdienst' }).click();
  await expect(page.getByRole('link', { name: /Dispo/ })).toBeVisible();

  await page.goto('/leitendenbereich/nikolaus-steuerung');
  await expect(page.getByRole('heading', { name: 'Besuchstage' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const save = page.getByRole('button', { name: 'Einstellungen speichern' });
  await expect(save).toBeDisabled();

  await page.getByRole('button', { name: 'Tag hinzufügen' }).click();
  await expect(page.getByLabel('Datum').last()).toHaveValue('2026-12-07');
  await page.getByLabel(/Nikolausverwaltung aktiv/).uncheck();
  await save.click();
  await expect(page.getByText(/^Gespeichert\./).first()).toBeVisible();
  await expect(save).toBeDisabled();

  // Only the Steuerung remains in the Leitendenbereich
  await page.goto('/leitendenbereich');
  await page.locator('summary', { hasText: 'Nikolausdienst' }).click();
  await expect(page.getByRole('link', { name: /Steuerung/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Dispo/ })).toHaveCount(0);

  // Restore the demo state for the following tests of this worker
  await page.goto('/leitendenbereich/nikolaus-steuerung');
  await page.getByLabel(/Nikolausverwaltung aktiv/).check();
  await page.getByRole('button', { name: /Tag .*7\. Dezember 2026.* entfernen/ }).click();
  await save.click();
  await expect(page.getByText(/^Gespeichert\./).first()).toBeVisible();
});

test('deleting needs the typed confirmation', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-steuerung');
  await page.getByRole('button', { name: 'Anmeldungen löschen …' }).click();
  const confirm = page.getByRole('button', { name: 'Anmeldungen endgültig löschen' });
  await expect(confirm).toBeDisabled();
  const input = page.getByLabel(/ANMELDUNGEN LÖSCHEN/);
  await input.fill('anmeldungen löschen');
  await expect(confirm).toBeDisabled();
  await input.fill('ANMELDUNGEN LÖSCHEN');
  await expect(confirm).toBeEnabled();
  // Not deleting: other tests of this worker need the demo bookings
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(confirm).toHaveCount(0);
});
