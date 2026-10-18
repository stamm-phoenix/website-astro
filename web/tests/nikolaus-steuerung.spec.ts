import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('the Steuerung switches the staff modules and saves days', async ({ page }) => {
  await page.goto('/leitendenbereich');
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
  await expect(page.getByRole('link', { name: /Steuerung/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Dispo/ })).toHaveCount(0);

  // Restore the demo state for the following tests of this worker
  await page.goto('/leitendenbereich/nikolaus-steuerung');
  await page.getByLabel(/Nikolausverwaltung aktiv/).check();
  await page.getByRole('button', { name: /Tag .*7\. Dezember 2026.* entfernen/ }).click();
  await save.click();
  await expect(page.getByText(/^Gespeichert\./).first()).toBeVisible();
});

test('typed numbers count as changes and are saved', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-steuerung');
  const save = page.getByRole('button', { name: 'Einstellungen speichern' });
  const hold = page.getByLabel('Reservierungsdauer (Minuten)');
  await expect(save).toBeDisabled();

  await hold.fill('90');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText(/^Gespeichert\./).first()).toBeVisible();
  await expect(hold).toHaveValue('90');

  // Restore the demo state for the following tests of this worker
  await hold.fill('120');
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

test('the menu follows the Steuerung without a reload', async ({ page }) => {
  await page.goto('/leitendenbereich/nikolaus-steuerung');
  await expect(page.locator('astro-island[component-url*="StaffNav"]')).not.toHaveAttribute('ssr');
  // The sidebar on wide screens, the sheet „Alle Bereiche“ on phones
  const expectDispo = async (count: number): Promise<void> => {
    const sheetButton = page.getByRole('button', { name: 'Alle Bereiche' });
    if (await sheetButton.isVisible()) {
      await sheetButton.click();
      const sheet = page.getByRole('dialog', { name: 'Alle Bereiche' });
      await expect(sheet.getByRole('link', { name: /^Dispo/ })).toHaveCount(count);
      await sheet.getByRole('button', { name: 'Schließen' }).click();
      await expect(sheet).toBeHidden();
    } else {
      await expect(
        page
          .getByRole('navigation', { name: 'Bereiche des Leitendenbereichs' })
          .getByRole('link', { name: 'Dispo', exact: true })
      ).toHaveCount(count);
    }
  };
  await expectDispo(1);

  const save = page.getByRole('button', { name: 'Einstellungen speichern' });
  await page.getByLabel(/Nikolausverwaltung aktiv/).uncheck();
  await save.click();
  await expect(page.getByText(/^Gespeichert\./).first()).toBeVisible();
  await expectDispo(0);

  // Restore the demo state for the following tests of this worker
  await page.getByLabel(/Nikolausverwaltung aktiv/).check();
  await save.click();
  await expect(page.getByText(/^Gespeichert\./).first()).toBeVisible();
  await expectDispo(1);
});
