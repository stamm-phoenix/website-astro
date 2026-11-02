import { test, expect } from './fixtures';
import { anlegen } from './essensplanung-helpers';

test('a rejected amount or an empty day says why, next to the field', async ({ page }) => {
  test.setTimeout(90_000);
  await anlegen(page, 'E2E Belege Feldfehler');
  await page.getByRole('tab', { name: 'Belege' }).click();
  await page.getByRole('button', { name: 'Ohne Foto eintragen' }).click();
  const neu = page.getByRole('region', { name: 'Neuer Beleg' });
  await neu.getByLabel('Betrag in €').fill('5,00');
  await neu.getByRole('button', { name: 'Beleg speichern' }).click();
  await expect(page.getByText('Beleg gespeichert.').first()).toBeVisible();

  const zeile = page.getByTestId('belege-tabelle').locator('tbody tr').first();
  const betrag = zeile.getByRole('textbox', { name: /^Betrag in €/ });
  await betrag.fill('0');
  await betrag.press('Enter');
  await expect(betrag).toHaveAccessibleDescription(/Bitte einen Betrag größer als 0 €/);
  await expect(zeile.getByText(/Bitte einen Betrag größer als 0 €/)).toBeVisible();
  await expect(betrag).toHaveValue('0');

  const datum = zeile.getByRole('textbox', { name: /^Datum/ });
  await datum.fill('');
  await datum.press('Enter');
  await expect(zeile.getByText('Bitte ein gültiges Datum angeben.')).toBeVisible();
  await expect(datum).toHaveAccessibleDescription('Bitte ein gültiges Datum angeben.');
});
