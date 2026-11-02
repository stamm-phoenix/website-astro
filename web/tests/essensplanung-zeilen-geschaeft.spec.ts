import { test, expect, expectNoHorizontalOverflow } from './fixtures';
import { anlegen } from './essensplanung-helpers';

test('the shop of an ingredient is typed in the line of a dish, a new name adds it', async ({
  page,
}) => {
  test.slow();
  await anlegen(page, 'E2E Zeile Geschäft');
  const dialog = page.getByRole('dialog');
  const geschaefte = page.getByRole('region', { name: 'Geschäfte' });

  // One shop exists already
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  await page.getByRole('button', { name: 'Geschäft hinzufügen' }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Metro');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog).toBeHidden();

  // A new line of the central list with a new shop: the shop is added and set
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Nudeln');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Nudeln angelegt.').first()).toBeVisible();
  const nudeln = page.locator('li', { has: page.getByText('Nudeln', { exact: true }) }).first();
  await nudeln.getByRole('button', { name: 'Mehr Angaben …' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Nudeln (Spag');
  await dialog.getByRole('option', { name: 'Nudeln (Spaghetti)' }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('500');
  const feld = dialog.getByLabel('Geschäft (optional)');
  await expect(feld).toHaveValue('');
  // The shops of the Planung are offered
  await feld.fill('me');
  await expect(dialog.getByRole('option', { name: 'Metro' })).toBeVisible();
  await feld.fill('Bäckerei Krume');
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Nudeln (Spaghetti) hinzugefügt.').first()).toBeVisible();

  // The dialog of the line shows the shop; a suggestion picks an existing one
  await nudeln.getByRole('button', { name: 'Nudeln (Spaghetti) ändern' }).click();
  await expect(feld).toHaveValue('Bäckerei Krume');
  await feld.fill('met');
  await dialog.getByRole('option', { name: 'Metro' }).click();
  await expect(feld).toHaveValue('Metro');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();

  // The shop belongs to the ingredient, so another dish with it shows it too
  await page.getByLabel('Neues Gericht').fill('Nudelsalat');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Nudelsalat angelegt.').first()).toBeVisible();
  const salat = page.locator('li', { has: page.getByText('Nudelsalat', { exact: true }) }).first();
  await salat.getByRole('button', { name: 'Mehr Angaben …' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Nudeln (Spag');
  await dialog.getByRole('option', { name: 'Nudeln (Spaghetti)' }).click();
  await expect(feld).toHaveValue('Metro');
  await feld.fill('');
  // The list of all shops closes first; it lies over the button below
  await feld.press('Escape');
  await expect(dialog.getByRole('option', { name: 'Metro' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog).toBeHidden();

  // Emptied: the ingredient has no shop any more; both shops stay
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  await expect(geschaefte).toContainText('Metro');
  await expect(geschaefte).toContainText('Bäckerei Krume');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await nudeln.getByRole('button', { name: 'Nudeln (Spaghetti) ändern' }).click();
  await expect(feld).toHaveValue('');
});

test('a shop that cannot be added keeps the line unsaved and the input', async ({ page }) => {
  await anlegen(page, 'E2E Zeile Geschäft Fehler');
  const dialog = page.getByRole('dialog');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Brot');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Brot angelegt.').first()).toBeVisible();
  const brot = page.locator('li', { has: page.getByText('Brot', { exact: true }) }).first();
  await brot.getByRole('button', { name: 'Mehr Angaben …' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Nudeln (Spag');
  await dialog.getByRole('option', { name: 'Nudeln (Spaghetti)' }).click();
  await dialog.getByLabel('Geschäft (optional)').fill('Markt');

  await page.route('**/api/essensplanung/planung/geschaefte', (route) =>
    route.fulfill({
      status: 400,
      json: {
        error: 'INVALID',
        code: 'INVALID',
        message: 'Die Eingaben sind unvollständig oder ungültig.',
        fields: { name: 'Höchstens 30 Geschäfte.' },
      },
    })
  );
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog.getByText('Höchstens 30 Geschäfte.')).toBeVisible();
  await expect(dialog.getByLabel('Geschäft (optional)')).toHaveValue('Markt');
  await expect(brot.getByText('Noch keine Zutaten.')).toBeVisible();

  await page.unroute('**/api/essensplanung/planung/geschaefte');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog).toBeHidden();
  await brot.getByRole('button', { name: 'Nudeln (Spaghetti) ändern' }).click();
  await expect(dialog.getByLabel('Geschäft (optional)')).toHaveValue('Markt');
});
