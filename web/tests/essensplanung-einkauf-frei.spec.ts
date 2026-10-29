import { test, expect, answerConfirm } from './fixtures';
import { anlegen, pdfLaden } from './essensplanung-helpers';

test('anything goes on the shopping list by name, without the list and an amount', async ({
  page,
}) => {
  await anlegen(page, 'E2E Einkauf frei');
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  const dialog = page.getByRole('dialog');

  // A name not in the list, just typed: on the list without an amount
  const feld = page.getByLabel('Noch etwas besorgen');
  await feld.fill('Kochhandschuhe');
  await feld.press('Enter');
  await expect(page.getByText('Kochhandschuhe steht auf der Einkaufsliste.').first()).toBeVisible();
  await expect(feld).toHaveValue('');
  await expect(feld).toBeFocused();
  const sonstiges = page.getByRole('list', { name: 'Ohne Geschäft: Sonstiges' });
  await expect(sonstiges).toContainText('Kochhandschuhe');
  await expect(sonstiges).not.toContainText('nach Gefühl');
  await expect(page.getByRole('list', { name: 'Zusatzbedarf' })).toContainText('Kochhandschuhe');

  // A read-only phase, e.g. maintenance, keeps what was typed
  const wartung = async (an: boolean): Promise<void> => {
    await page.unroute('**/api/essensplanung/planung/stand?*');
    await page.route('**/api/essensplanung/planung/stand?*', async (route) => {
      const url = route
        .request()
        .url()
        .replace(/seit=[^&]*/, 'seit=0');
      const antwort = await route.fetch({ url });
      const json = await antwort.json();
      if (json.ansicht) json.ansicht.wartung = an;
      await route.fulfill({ response: antwort, json });
    });
  };
  await feld.fill('Kehrblech');
  await wartung(true);
  await expect(feld).toHaveCount(0, { timeout: 15_000 });
  await wartung(false);
  await expect(feld).toHaveValue('Kehrblech', { timeout: 15_000 });
  await page.unroute('**/api/essensplanung/planung/stand?*');

  // A name of the list takes that ingredient
  await feld.fill('Spülmittel');
  await feld.press('Enter');
  await expect(page.getByRole('list', { name: 'Ohne Geschäft: Reinigung/Hygiene' })).toContainText(
    'Spülmittel'
  );

  // The amount can come later, also for a thing of its own
  await page.getByRole('button', { name: 'Kochhandschuhe ändern' }).click();
  await expect(dialog.getByLabel('Zutat', { exact: true })).toHaveValue('Kochhandschuhe');
  // A thing of its own typed without an amount is counted in pieces
  await dialog.getByLabel('Menge (optional)').fill('2');
  await expect(dialog.getByLabel('Einheit', { exact: true })).toHaveValue('stueck');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(sonstiges).toContainText('2 Stück Kochhandschuhe');

  // An ingredient of the list put on without an amount gets an amount in its own unit later
  await feld.fill('Salz');
  await feld.press('Enter');
  await expect(page.getByText('Salz steht auf der Einkaufsliste.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Salz ändern', exact: true }).click();
  await dialog.getByLabel('Menge (optional)').fill('500');
  await expect(dialog.getByLabel('Einheit', { exact: true })).toHaveValue('g');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('list', { name: 'Zusatzbedarf' })).toContainText('500 g Salz');

  // The dialog takes a name of its own too, without an amount
  await page.getByRole('button', { name: 'Zusatzbedarf eintragen' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Grillanzünder');
  await dialog.getByRole('button', { name: 'Eintragen' }).click();
  await expect(dialog).toBeHidden();
  await expect(sonstiges).toContainText('Grillanzünder');

  // The PDF lists them like the page
  const pdf = await pdfLaden(page, () =>
    page.getByRole('button', { name: 'Einkaufsliste als PDF' }).click()
  );
  expect(pdf.text).toContain('Grillanzünder');
  expect(pdf.text).not.toContain('nach Gefühl');

  // What is no food is not offered for dishes
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Nudeln');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Nudeln angelegt.').first()).toBeVisible();
  const zutat = page.getByLabel('Neue Zutat für Nudeln');
  await zutat.fill('Kochhand');
  await expect(page.getByRole('option', { name: /Kochhandschuhe/ })).toHaveCount(0);

  // Removing it takes it off the list
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  await page.getByRole('button', { name: 'Grillanzünder entfernen' }).click();
  await answerConfirm(page, 'Grillanzünder entfernen?', 'Entfernen');
  await expect(sonstiges).not.toContainText('Grillanzünder');
});
