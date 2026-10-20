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

  // The demo account is registered for the hike as a person of its own, with its address
  await page.goto('/leitendenbereich/aktionen/aktion?id=evt_HikeMangfall');
  await expect(page.getByText('(ich)').filter({ visible: true })).toHaveCount(1);
});
