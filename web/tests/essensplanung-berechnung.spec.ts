import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { anlegen } from './essensplanung-helpers';

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
  await chili.getByRole('button', { name: 'Zutat hinzufügen' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Hackfl');
  await dialog.getByRole('option', { name: 'Hackfleisch' }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('400');
  await dialog.getByLabel('Einheit', { exact: true }).selectOption('g');
  await dialog.getByLabel('vegetarisch', { exact: true }).uncheck();
  await dialog.getByLabel('vegan', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(chili.getByText('400 g')).toBeVisible();

  // 10 Pfadis with everything, 5 vegetarian Rover (factor 1,2)
  await page.getByRole('tab', { name: 'Teilnehmende' }).click();
  for (const [gruppe, anzahl, ernaehrung] of [
    ['Pfadi', '10', 'alles'],
    ['Rover', '5', 'vegetarisch'],
  ]) {
    await page.getByRole('button', { name: 'Teilnehmende hinzufügen' }).click();
    await dialog.getByLabel('Gruppe', { exact: true }).selectOption({ label: gruppe });
    await dialog.getByLabel('Anzahl').fill(anzahl);
    await dialog.getByLabel('Ernährung').selectOption(ernaehrung);
    await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(dialog).toBeHidden();
  }

  // At lunch: 16 portions, the mince for the 10 who eat meat: 400 g ÷ 4 × 10 = 1 kg
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Gericht einplanen bei 1_2' }).click();
  await dialog.getByLabel('Gericht', { exact: true }).selectOption({ label: 'Chili' });
  await dialog.getByRole('button', { name: 'Einplanen' }).click();
  await expect(page.getByText('Chili eingeplant.').first()).toBeVisible();
  await page.locator('summary', { hasText: 'Mengen für 16 Portionen' }).first().click();
  const mengen = page.getByRole('list', { name: 'Mengen für Chili bei 1_2' }).first();
  await expect(mengen).toContainText('1 kg Hackfleisch · für 10 Portionen');
  await expectNoHorizontalOverflow(page);

  // Half of it at dinner
  await page.getByRole('button', { name: 'Gericht einplanen bei 1_4' }).click();
  await dialog.getByLabel('Gericht', { exact: true }).selectOption({ label: 'Chili' });
  await dialog.getByLabel('Faktor', { exact: true }).fill('0,5');
  await dialog.getByRole('button', { name: 'Einplanen' }).click();
  await expect(dialog).toBeHidden();
  await page.locator('summary', { hasText: 'Mengen für 16 Portionen' }).nth(1).click();
  await expect(page.getByRole('list', { name: 'Mengen für Chili bei 1_4' }).first()).toContainText(
    '500 g Hackfleisch'
  );
});
