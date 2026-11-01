import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { anlegen, aufklappen, einplanen, zeilenMenge } from './essensplanung-helpers';

test('a planned dish shows its amounts for the people who eat at the meal', async ({ page }) => {
  // Many steps through three areas: more than the usual time
  test.slow();
  await anlegen(page, 'E2E Berechnung');
  const dialog = page.getByRole('dialog');

  // Chili for 4: 400 g mince only for those who eat meat, 1 pack of spices fixed
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Chili');
  await page.getByLabel('Personen', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Chili angelegt.').first()).toBeVisible();
  const chili = page.locator('li', { has: page.getByText('Chili', { exact: true }) }).first();
  await chili.getByRole('button', { name: 'Mehr Angaben …' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Hackfl');
  await dialog.getByRole('option', { name: 'Hackfleisch' }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('400');
  await dialog.getByLabel('Einheit', { exact: true }).fill('g');
  await dialog.getByLabel('vegetarisch', { exact: true }).uncheck();
  await dialog.getByLabel('vegan', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect.poll(() => zeilenMenge(chili, 'Hackfleisch')).toBe('400 g');
  // Two lines of oil: 40 ml in the pot, 40 ml for a gluten-free pot of its own
  for (const art of ['nicht dafür', 'nur dafür (Ersatz)']) {
    await chili.getByRole('button', { name: 'Mehr Angaben …' }).click();
    await dialog.getByLabel('Zutat', { exact: true }).fill('Sonnenblumen');
    await dialog.getByRole('option', { name: 'Sonnenblumenöl' }).click();
    await dialog.getByLabel('Menge', { exact: true }).fill('40');
    await dialog.getByLabel('Einheit', { exact: true }).fill('ml');
    await dialog.getByText('Unverträglichkeiten').click();
    await dialog.getByLabel('Gluten', { exact: true }).selectOption({ label: art });
    await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(dialog).toBeHidden();
  }

  // 10 Pfadis with everything, 5 vegetarian Rover (factor 1,2) who cannot eat gluten
  await page.getByRole('tab', { name: 'Teilnehmende' }).click();
  for (const [gruppe, anzahl, ernaehrung] of [
    ['Pfadi', '10', 'alles'],
    ['Rover', '5', 'vegetarisch'],
  ]) {
    await page.getByRole('button', { name: 'Teilnehmende hinzufügen' }).click();
    await dialog.getByLabel('Gruppe', { exact: true }).selectOption({ label: gruppe });
    await dialog.getByLabel('Anzahl').fill(anzahl);
    await dialog.getByLabel('Ernährung').selectOption(ernaehrung);
    if (gruppe === 'Rover') await dialog.getByLabel('Gluten').check();
    await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(dialog).toBeHidden();
  }

  // At lunch: 16 portions, the mince for the 10 who eat meat: 400 g ÷ 4 × 10 = 1 kg
  await page.getByRole('tab', { name: 'Plan' }).click();
  await einplanen(page, '1_2', 'Chili');
  await expect(page.getByRole('list', { name: 'Gerichte bei 1_2' })).toContainText('16 Portionen');
  await aufklappen(page, '1_2_1', 'Chili');
  const mengen = page.getByRole('list', { name: 'Mengen für Chili bei 1_2' }).first();
  await expect(mengen).toContainText('1 kg Hackfleisch · nur mit allem · für 10 Portionen');
  // The two lines of oil read apart: 40 ml ÷ 4 × 10, and 40 ml ÷ 4 × 6 for the Rover
  await expect(mengen).toContainText('100 ml Sonnenblumenöl · nicht bei Gluten · für 10 Portionen');
  await expect(mengen).toContainText('60 ml Sonnenblumenöl · nur bei Gluten · für 6 Portionen');
  await expectNoHorizontalOverflow(page);

  // Half of it at dinner
  await einplanen(page, '1_4', 'Chili');
  await aufklappen(page, '1_4_1', 'Chili');
  await page.getByRole('button', { name: 'Chili bei 1_4_1 ändern' }).click();
  await dialog.getByLabel('Faktor', { exact: true }).fill('0,5');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  // The portions follow the factor too: 16 × 0,5
  await expect(page.getByText('Mengen für 8 Portionen')).toBeVisible();
  const abend = page.getByRole('list', { name: 'Mengen für Chili bei 1_4' }).first();
  await expect(abend).toContainText('500 g Hackfleisch · nur mit allem · für 5 Portionen');
  await expect(abend).toContainText('30 ml Sonnenblumenöl · nur bei Gluten · für 3 Portionen');
});
