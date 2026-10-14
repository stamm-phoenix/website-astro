import { test, expect, expectNoHorizontalOverflow } from './fixtures';

test('a recording is uploaded, transcribed and its notes edited', async ({ page }) => {
  // The page polls the transcription every 10 seconds, which leaves little room in 30 on CI
  test.setTimeout(60_000);
  await page.goto('/leitendenbereich');
  await page.getByRole('link', { name: /Mitschriften/ }).click();
  await expect(page.getByRole('heading', { name: 'Mitschriften', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Leitendenrunde', exact: true })).toBeVisible();
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

  // Two sentences cut apart are joined; the text is suggested and can be checked
  await page.getByRole('button', { name: 'Abschnitte auswählen' }).click();
  await page.getByRole('checkbox', { name: 'Abschnitt ab 00:00 auswählen' }).check();
  await page.getByRole('checkbox', { name: 'Abschnitt ab 00:05 auswählen' }).check();
  await page.getByRole('button', { name: 'Zusammenfügen' }).click();
  const merge = page.getByRole('dialog');
  await expect(merge.getByLabel('Text')).toHaveValue(
    'Willkommen zum Treffen, schön dass alle da sind wir planen heute das Sommerlager.'
  );
  await merge.getByLabel('Text').fill('Willkommen zum Treffen! Wir planen heute das Sommerlager.');
  await merge.getByRole('button', { name: 'Zusammenfügen' }).click();
  await expect(page.getByText('Abschnitte zusammengefügt.').first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Willkommen zum Treffen! Wir planen heute das Sommerlager\./ })
  ).toBeVisible();
  await expect(page.getByText('Notizen sind nicht mehr aktuell')).toBeVisible();
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

  // When a sentence ends can be tried out; 1,0 s is preselected
  const satzende = page.getByRole('group', { name: 'Satzende nach einer Sprechpause von' });
  await expect(satzende.getByRole('button', { name: '1,0 s' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await satzende.getByRole('button', { name: 'Semantic (KI)' }).click();
  await expect(satzende.getByRole('button', { name: 'Semantic (KI)' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'test-results/mitschrift-live.png', fullPage: true });
});
