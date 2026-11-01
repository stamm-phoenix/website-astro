import { test, expect } from './fixtures';
import { anlegen } from './essensplanung-helpers';

test('one ingredient in g and in Bund keeps typed input per thing while shopping', async ({
  page,
}) => {
  test.slow();
  await anlegen(page, 'E2E Einheiten Einkauf');
  // TK-Petersilie needed in Bund and in g, and one trip for everything
  const url = new URL(page.url());
  const headers = { 'x-essensplanung-token': new URLSearchParams(url.hash.slice(1)).get('t')! };
  const base = `${url.origin}/api/essensplanung/planung`;
  const katalog = await (await page.request.get(`${base}/katalog`, { headers })).json();
  const petersilie = katalog.zutaten.find((z: { name: string }) => z.name === 'TK-Petersilie');
  for (const [menge, einheit] of [
    [3, 'bund'],
    [200, 'g'],
  ] as const) {
    const neu = await page.request.post(`${base}/zusatzbedarf`, {
      headers,
      data: { zutatId: petersilie.id, menge, einheit, hinweis: '' },
    });
    expect(neu.ok()).toBe(true);
  }
  expect(
    (await page.request.post(`${base}/einkaeufe`, { headers, data: { name: 'Montag' } })).ok()
  ).toBe(true);
  await page.reload();
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  await page.getByRole('button', { name: 'Montag: Einkaufen' }).click();
  const montag = page.getByRole('region', { name: 'Montag', exact: true });

  // Each thing has controls of its own, named by its unit
  const bund = montag.getByRole('listitem').filter({
    has: page.getByLabel('Erhaltene Menge von TK-Petersilie (Bund)'),
  });
  const gramm = montag.getByRole('listitem').filter({
    has: page.getByLabel('Erhaltene Menge von TK-Petersilie (g)'),
  });
  await bund.getByLabel('Erhaltene Menge von TK-Petersilie (Bund)').fill('4');
  await bund.getByLabel('Ersatz für TK-Petersilie (Bund)').fill('glatt');
  await gramm.getByLabel('Erhaltene Menge von TK-Petersilie (g)').fill('250');
  await gramm.getByLabel('Ersatz für TK-Petersilie (g)').fill('tiefgekühlt');

  // To the list and back: both inputs are still there, each at its thing
  await montag.getByRole('button', { name: 'Liste anpassen' }).click();
  await montag.getByRole('button', { name: 'Einkaufen', exact: true }).click();
  await expect(montag.getByLabel('Erhaltene Menge von TK-Petersilie (Bund)')).toHaveValue('4');
  await expect(montag.getByLabel('Ersatz für TK-Petersilie (Bund)')).toHaveValue('glatt');
  await expect(montag.getByLabel('Erhaltene Menge von TK-Petersilie (g)')).toHaveValue('250');
  await expect(montag.getByLabel('Ersatz für TK-Petersilie (g)')).toHaveValue('tiefgekühlt');

  // Discarding one leaves the other
  await gramm.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(montag.getByLabel('Erhaltene Menge von TK-Petersilie (g)')).toHaveValue('200');
  await expect(montag.getByLabel('Ersatz für TK-Petersilie (g)')).toHaveValue('');
  await expect(montag.getByLabel('Erhaltene Menge von TK-Petersilie (Bund)')).toHaveValue('4');
  await expect(montag.getByLabel('Ersatz für TK-Petersilie (Bund)')).toHaveValue('glatt');

  // Ticked off, it stays with its own amount and replacement
  await montag.getByRole('checkbox', { name: 'TK-Petersilie (Bund) abhaken' }).click();
  await expect(montag.getByRole('status')).toHaveText('1 von 2 abgehakt');
  await expect(bund).toContainText('4 Bund → glatt');
});
