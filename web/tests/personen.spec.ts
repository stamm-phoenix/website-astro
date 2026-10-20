import { expect, test } from './fixtures';

test('leaders are linked to CampFlow and find themselves in an Aktion', async ({ page }) => {
  await page.request.post('/api/__mock/personen/reset');
  await page.goto('/leitendenbereich/personen');
  const leitende = page.getByRole('region', { name: 'Leitende', exact: true });
  await expect(leitende).toContainText('2 von 6 Leitenden');
  // Same name, one person in CampFlow: a suggestion, saved only on request
  await expect(leitende).toContainText('Vorschlag: Lea Leiterin');
  await page.getByRole('button', { name: 'Alle Vorschläge übernehmen' }).click();
  await expect(page.getByText('2 Vorschläge übernommen.').first()).toBeVisible();
  await expect(leitende).toContainText('CampFlow: Lea Leiterin');

  // Two persons with the same name: picked by hand
  await page.getByRole('button', { name: 'Verknüpfen: Max Muster' }).click();
  const dialog = page.getByRole('dialog', { name: 'CampFlow-Person von Max Muster' });
  await dialog.getByLabel('Person in CampFlow').fill('muster');
  await dialog.getByRole('button', { name: /Max Muster.*Leiter\*in/ }).click();
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(leitende).toContainText('5 von 6 Leitenden');

  // Enter in the search picks a single match and never saves the dialog
  await page.getByRole('button', { name: 'Bearbeiten: Demo Leitung' }).click();
  const eigener = page.getByRole('dialog', { name: 'CampFlow-Person von Demo Leitung' });
  await eigener.getByRole('button', { name: 'Andere Person wählen' }).click();
  await eigener.getByLabel('Person in CampFlow').fill('muster');
  await eigener.getByLabel('Person in CampFlow').press('Enter');
  await expect(eigener).toBeVisible();
  await expect(eigener.getByText('Tippe auf die richtige Person.')).toBeVisible();
  // The removed link is an unsaved change, so closing asks first
  await eigener.getByRole('button', { name: 'Abbrechen' }).click();
  await page
    .getByRole('dialog', { name: 'Änderungen verwerfen?' })
    .getByRole('button', { name: 'Änderungen verwerfen' })
    .click();
  await expect(leitende).toContainText('CampFlow: Demo Leitung');

  // The demo account is registered for the Georgsfest as a person of its own, under another
  // name: the server finds it by the address of the linked person, which the page never gets
  await page.goto('/leitendenbereich/aktionen/aktion?id=evt_Georgsfest');
  await expect(page.getByText('(ich)').filter({ visible: true })).toHaveCount(1);
  const ich = await page.request.get('/api/intern/ich');
  expect(JSON.stringify(await ich.json())).not.toContain('demo.leitung@example.org');

  // Without the link the Aktion, opened again within the app, no longer shows it as the own one
  await page.getByRole('link', { name: 'Leitendenbereich – Übersicht' }).click();
  await page
    .getByRole('link', { name: /^Personen/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Bearbeiten: Demo Leitung' }).click();
  const loesen = page.getByRole('dialog', { name: 'CampFlow-Person von Demo Leitung' });
  await loesen.getByRole('button', { name: 'Andere Person wählen' }).click();
  await loesen.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Demo Leitung gespeichert.').first()).toBeVisible();
  // A link within the app, so the page changes without a full load and keeps what it loaded
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/leitendenbereich/aktionen/aktion?id=evt_Georgsfest';
    link.textContent = 'Georgsfest';
    document.querySelector('main')?.append(link);
    link.click();
  });
  await expect(page.getByRole('heading', { name: 'Georgsfest des Bezirks' })).toBeVisible();
  await expect(page.getByText('Demo L.').filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText('(ich)').filter({ visible: true })).toHaveCount(0);
});
