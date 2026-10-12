import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('a recording is uploaded, transcribed and its notes edited', async ({ page }) => {
  await page.goto('/leitendenbereich');
  await page.getByRole('link', { name: /Mitschriften/ }).click();
  await expect(page.getByRole('heading', { name: 'Mitschriften', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Leitendenrunde' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Alte Mitschriften aufräumen' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Without the consent nothing is created
  await page.getByRole('button', { name: 'Audiodatei hochladen' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Titel').fill('Stavo-Runde Test');
  await dialog.getByRole('button', { name: 'Weiter zum Hochladen' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Alle Anwesenden wurden informiert/).check();
  await dialog.getByRole('button', { name: 'Weiter zum Hochladen' }).click();

  await expect(page.getByRole('heading', { name: 'Stavo-Runde Test' })).toBeVisible();
  await page.getByLabel('Audiodatei').setInputFiles({
    name: 'aufnahme.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('ID3 test'),
  });
  await page.getByRole('button', { name: 'Hochladen und transkribieren' }).click();
  await expect(page.getByText('Die Aufnahme wird transkribiert …')).toBeVisible();

  // The page asks for the result by itself, then writes the notes
  await expect(page.getByText('Wir planen heute das Sommerlager.')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('Notizen prüfen')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Notizen bearbeiten' }).click();
  await page.getByRole('dialog').getByLabel('Beschlüsse').fill('Wir fahren ins Sommerlager.');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Wir fahren ins Sommerlager.')).toBeVisible();

  // Generating again asks first, because the notes were changed by hand
  await page.getByRole('button', { name: 'Notizen neu erzeugen' }).click();
  await expect(page.getByText(/Beim Neu-Erzeugen gehen diese Änderungen verloren/)).toBeVisible();
  await page.getByRole('button', { name: 'Abbrechen' }).click();

  // Delete the Mitschrift again
  await page.getByRole('button', { name: 'Mitschrift löschen' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.getByRole('heading', { name: 'Mitschriften', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Stavo-Runde Test' })).toHaveCount(0);
});

test('starting a live Mitschrift goes to the recording without a warning', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type());
    void dialog.dismiss();
  });
  await page.goto('/leitendenbereich/mitschriften');
  await page.getByRole('button', { name: 'Live aufnehmen' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Titel').fill('Leitendenrunde Live-Test');
  await dialog.getByLabel('Datum des Meetings').fill('2026-10-01');
  await dialog.getByLabel(/Alle Anwesenden wurden informiert/).check();
  await dialog.getByRole('button', { name: 'Weiter zur Aufnahme' }).click();

  await expect(page.getByRole('heading', { name: 'Leitendenrunde Live-Test' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Live-Aufnahme' })).toBeVisible();
  expect(dialogs, 'No warning about unsaved changes').toEqual([]);
});
