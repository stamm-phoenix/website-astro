import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';
import { anlegen } from './essensplanung-helpers';

test('dishes get ingredients from the list, warnings and a recipe card', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E Gerichte');
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());

  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Chili');
  await page.getByLabel('Personen', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Chili angelegt.').first()).toBeVisible();
  const chili = page.locator('li', { has: page.getByText('Chili', { exact: true }) }).first();

  // A line from the central list in the unit of the ingredient, only for those who eat meat
  await chili.getByRole('button', { name: 'Zutat hinzufügen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Zutat für Chili' });
  await dialog.getByLabel('Zutat', { exact: true }).fill('Hackfl');
  await dialog.getByRole('option', { name: 'Hackfleisch' }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('1,5');
  await dialog.getByLabel('Einheit', { exact: true }).selectOption('kg');
  await dialog.getByLabel('vegetarisch', { exact: true }).uncheck();
  await dialog.getByLabel('vegan', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(chili.getByText('1,5 kg')).toBeVisible();
  await expect(chili.getByText('nur mit allem')).toBeVisible();
  await expect(
    chili.getByText('Für vegetarisch Essende gibt es in diesem Gericht keine Zutat.')
  ).toBeVisible();

  // An ingredient of the Planung's own, without an amount
  await chili.getByRole('button', { name: 'Zutat hinzufügen' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Omas Chiligewürz');
  await dialog.getByRole('button', { name: 'Als eigene Zutat dieser Planung anlegen' }).click();
  await dialog.getByLabel('Kategorie', { exact: true }).selectOption({ label: 'Gewürz' });
  await dialog.getByLabel('Gemessen in', { exact: true }).selectOption({ label: 'Gewicht (g/kg)' });
  await dialog.getByLabel('Ernährung', { exact: true }).selectOption('vegan');
  await dialog.getByLabel('Hinweis (optional)').fill('nach Geschmack');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(chili.getByText('Omas Chiligewürz')).toBeVisible();
  await expect(chili.getByText('(nach Geschmack)')).toBeVisible();
  await expect(chili.getByText(/Für vegetarisch Essende/)).toHaveCount(0);

  // Instructions and tools; the other window sees them
  await chili.getByLabel('Anleitung (optional)').fill('Hack anbraten, würzen.');
  await chili.getByLabel('Werkzeuge (optional)').fill('Großer Topf');
  await chili.getByLabel('Werkzeuge (optional)').press('Enter');
  await chili.getByRole('button', { name: 'Gericht speichern' }).click();
  await expect(page.getByText('Chili gespeichert.').first()).toBeVisible();
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText('Chili', { exact: true }).click();
  await expect(anderes.getByLabel('Anleitung (optional)')).toHaveValue('Hack anbraten, würzen.', {
    timeout: 15_000,
  });
  await expect(anderes.getByText('Omas Chiligewürz').first()).toBeVisible();

  // Lines move and go
  await chili.getByRole('button', { name: 'Omas Chiligewürz nach oben' }).click();
  await expect(chili.locator('ol > li').first()).toContainText('Omas Chiligewürz');
  await chili.getByRole('button', { name: 'Hackfleisch entfernen' }).click();
  await answerConfirm(page, 'Hackfleisch entfernen?', 'Entfernen');
  await expect(chili.getByText('1,5 kg')).toHaveCount(0);

  // The recipe card prints alone
  await page.getByLabel('Neues Gericht').fill('Pudding');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Pudding angelegt.').first()).toBeVisible();
  await page.evaluate(() => (window.print = () => undefined));
  await chili.getByRole('button', { name: 'Rezeptkarte drucken' }).click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByText('Pudding', { exact: true })).toBeHidden();
  await expect(chili.getByText('Hack anbraten, würzen.')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await expectNoHorizontalOverflow(page);
  await anderes.context().close();
});

test('the read-only link shows dishes without editing', async ({ page, browser }) => {
  await anlegen(page, 'E2E Gerichte lesen');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Brotzeit');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Brotzeit angelegt.').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Mitglieder' }).click();
  await page.getByRole('button', { name: 'Link erzeugen', exact: true }).nth(1).click();
  // The personal link and then the new read-only link
  await expect(
    page.locator('.copy-code .font-mono').filter({ hasText: '/essensplanung/planung#t=' })
  ).toHaveCount(2);
  const lesen = await page
    .locator('.copy-code .font-mono')
    .filter({ hasText: '/essensplanung/planung#t=' })
    .last()
    .textContent();
  const leser = await (await browser.newContext()).newPage();
  await leser.goto(lesen!.trim());
  await leser.getByRole('tab', { name: 'Gerichte' }).click();
  await leser.getByText('Brotzeit', { exact: true }).click();
  await expect(leser.getByText('Noch keine Zutaten.')).toBeVisible();
  await expect(leser.getByRole('button', { name: 'Zutat hinzufügen' })).toHaveCount(0);
  await expect(leser.getByLabel('Neues Gericht')).toHaveCount(0);
  await leser.context().close();
});
