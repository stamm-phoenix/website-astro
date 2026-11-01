import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { anlegen, zeilenMenge } from './essensplanung-helpers';

test('a line takes a unit of its own, and units of one ingredient are brought into line', async ({
  page,
}) => {
  test.slow();
  await anlegen(page, 'E2E Einheiten eigene');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  for (const name of ['Kräuterquark', 'Kartoffelsuppe']) {
    await page.getByLabel('Neues Gericht').fill(name);
    await page.getByRole('button', { name: 'Anlegen' }).click();
    await expect(page.getByText(`${name} angelegt.`).first()).toBeVisible();
  }
  const quark = page
    .locator('li', { has: page.getByText('Kräuterquark', { exact: true }) })
    .first();
  const suppe = page
    .locator('li', { has: page.getByText('Kartoffelsuppe', { exact: true }) })
    .first();

  // Herbs of the list are weighed in g, but the row takes „Bund“; Enter adds the line
  const zutat = quark.getByLabel('Neue Zutat für Kräuterquark');
  await zutat.pressSequentially('TK-Peters');
  await zutat.press('Enter');
  await quark.getByLabel('Menge der neuen Zutat').fill('3');
  const einheit = quark.getByLabel('Einheit der neuen Zutat');
  await expect(einheit).toHaveValue('g');
  // All units are suggested until something is typed, those of the ingredient first
  await einheit.click();
  await expect(quark.getByRole('option', { name: 'kg' })).toBeVisible();
  await expect(quark.getByRole('option', { name: 'Dose' })).toBeVisible();
  await einheit.fill('bund');
  await einheit.press('Enter');
  await expect.poll(() => zeilenMenge(quark, 'TK-Petersilie')).toBe('3 Bund');

  // The same herbs in grams in another dish (a new dish is open already)
  const zweite = suppe.getByLabel('Neue Zutat für Kartoffelsuppe');
  await zweite.pressSequentially('TK-Peters');
  await zweite.press('Enter');
  await suppe.getByLabel('Menge der neuen Zutat').fill('200');
  await suppe.getByLabel('Menge der neuen Zutat').press('Enter');
  await expect.poll(() => zeilenMenge(suppe, 'TK-Petersilie')).toBe('200 g');

  // The page offers to bring them into one unit; the demo AI proposes Bund at 20 g
  await page
    .getByRole('button', { name: 'TK-Petersilie steht in g, Bund: vereinheitlichen' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Einheiten von TK-Petersilie' });
  await expect(dialog.getByText('KI-Schätzung, ungeprüft:')).toBeVisible();
  await expect(dialog.getByLabel('Alles in')).toHaveValue('Bund');
  const zeilen = dialog.getByTestId('einheiten-zeile');
  await expect(zeilen.filter({ hasText: 'Kartoffelsuppe' })).toContainText('→ 10 Bund');
  // The factor can be changed before taking it over
  await dialog.getByLabel('So viel Bund ist 1 g').fill('0,1');
  await expect(zeilen.filter({ hasText: 'Kartoffelsuppe' })).toContainText('→ 20 Bund');
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: 'Eine Menge umrechnen' }).click();
  await expect(page.getByText('TK-Petersilie steht jetzt in Bund.').first()).toBeVisible();
  await expect.poll(() => zeilenMenge(suppe, 'TK-Petersilie')).toBe('20 Bund');
  await expect(page.getByRole('button', { name: /vereinheitlichen/ })).toHaveCount(0);
});
