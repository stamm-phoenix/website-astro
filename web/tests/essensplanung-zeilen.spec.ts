import { test, expect, answerConfirm } from './fixtures';
import { anlegen, zeilenMenge } from './essensplanung-helpers';

test('lines are typed and changed right in the rows, like in a sheet', async ({
  page,
  browser,
}) => {
  test.slow();
  await anlegen(page, 'E2E Zeilen');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Nudeln mit Soße');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Nudeln mit Soße angelegt.').first()).toBeVisible();
  const gericht = page
    .locator('li', { has: page.getByText('Nudeln mit Soße', { exact: true }) })
    .first();

  // The new row: Enter in the name takes the suggestion, Enter in the amount adds the line,
  // and the next line starts in the name again
  const zutat = gericht.getByLabel('Neue Zutat für Nudeln mit Soße');
  await zutat.pressSequentially('Hackfl');
  await zutat.press('Enter');
  await expect(zutat).toHaveValue('Hackfleisch');
  await gericht.getByLabel('Menge der neuen Zutat').fill('500');
  await gericht.getByLabel('Menge der neuen Zutat').press('Enter');
  await expect.poll(() => zeilenMenge(gericht, 'Hackfleisch')).toBe('500 g');
  await expect(zutat).toHaveValue('');
  await expect(zutat).toBeFocused();

  // A name not in the list points to the dialog
  await zutat.fill('Drachenfrucht-Sirup');
  await gericht.getByRole('button', { name: 'Zeile zu Nudeln mit Soße hinzufügen' }).click();
  await expect(gericht.getByText(/steht nicht in der Liste/)).toBeVisible();
  await zutat.fill('');

  // Changing the amount in the row saves when the row is left
  const menge = gericht.getByLabel('Menge von Hackfleisch');
  await menge.fill('750');
  await gericht.getByLabel('Hinweis zu Hackfleisch').fill('gemischt');
  const gespeichert = page.waitForResponse(
    (antwort) =>
      antwort.url().includes('/gericht-zutaten/') && antwort.request().method() === 'PATCH'
  );
  await page.getByRole('heading', { name: 'E2E Zeilen' }).click();
  expect((await gespeichert).ok()).toBe(true);
  await page.reload();
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByText('Nudeln mit Soße', { exact: true }).click();
  await expect(menge).toBeVisible();
  await expect.poll(() => zeilenMenge(gericht, 'Hackfleisch')).toBe('750 g');
  await expect(gericht.getByLabel('Hinweis zu Hackfleisch')).toHaveValue('gemischt');

  // Escape puts the row back; Enter saves without leaving it
  await menge.fill('1');
  await menge.press('Escape');
  await expect(menge).toHaveValue('750');
  await gericht.getByLabel('Einheit von Hackfleisch').fill('kg');
  await menge.fill('1');
  const nochmal = page.waitForResponse(
    (antwort) =>
      antwort.url().includes('/gericht-zutaten/') && antwort.request().method() === 'PATCH'
  );
  await menge.press('Enter');
  expect((await nochmal).ok()).toBe(true);
  await expect(menge).toBeFocused();
  await page.reload();
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await expect.poll(() => zeilenMenge(gericht, 'Hackfleisch')).toBe('1 kg');
  await page.getByText('Nudeln mit Soße', { exact: true }).click();
  await expect(menge).toBeVisible();

  // „Mehr Angaben …“ takes what was typed, the unit too
  await zutat.pressSequentially('Tomatenm');
  await zutat.press('Enter');
  await gericht.getByLabel('Menge der neuen Zutat').fill('2');
  await gericht.getByLabel('Einheit der neuen Zutat').fill('kg');
  // The suggestions of the unit close first; on a phone they lie over the button below
  await gericht.getByLabel('Einheit der neuen Zutat').press('Escape');
  await gericht.getByRole('button', { name: 'Mehr Angaben …' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Menge', { exact: true })).toHaveValue('2');
  await expect(dialog.getByLabel('Einheit', { exact: true })).toHaveValue('kg');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Verwerfen');

  // „Ändern“ saves what the row shows first, so the dialog starts from it
  await menge.fill('900');
  await gericht.getByRole('button', { name: 'Hackfleisch ändern' }).click();
  await expect(dialog.getByLabel('Menge', { exact: true })).toHaveValue('900');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toHaveCount(0);

  // A change of others that comes while the row has focus shows once the row is left
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText('Nudeln mit Soße', { exact: true }).click();
  await menge.focus();
  await anderes.getByLabel('Hinweis zu Hackfleisch').fill('vom Metzger');
  await anderes.getByLabel('Hinweis zu Hackfleisch').press('Enter');
  await expect(anderes.getByLabel('Hinweis zu Hackfleisch')).toHaveValue('vom Metzger');
  await page.waitForTimeout(5_000);
  await expect(gericht.getByLabel('Hinweis zu Hackfleisch')).toHaveValue('gemischt');
  await page.getByRole('heading', { name: 'E2E Zeilen' }).click();
  await expect(gericht.getByLabel('Hinweis zu Hackfleisch')).toHaveValue('vom Metzger', {
    timeout: 15_000,
  });

  // Others remove a line with unsaved input: the input is named to copy
  await menge.fill('1200');
  await anderes.getByRole('button', { name: 'Hackfleisch entfernen' }).click();
  await answerConfirm(anderes, 'Hackfleisch entfernen?', 'Entfernen');
  await expect(
    page.getByText(/Hackfleisch wurde gerade entfernt \(deine Eingabe: 1200 kg/).first()
  ).toBeVisible({
    timeout: 20_000,
  });
});

test('typed input survives a slow save, removing and a read-only phase', async ({ page }) => {
  test.slow();
  await anlegen(page, 'E2E Zeilen sicher');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Gulasch');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Gulasch angelegt.').first()).toBeVisible();
  const gericht = page.locator('li', { has: page.getByText('Gulasch', { exact: true }) }).first();
  const zutat = gericht.getByLabel('Neue Zutat für Gulasch');
  await zutat.pressSequentially('Hackfl');
  await zutat.press('Enter');
  await gericht.getByLabel('Menge der neuen Zutat').fill('500');
  await gericht.getByLabel('Menge der neuen Zutat').press('Enter');
  const menge = gericht.getByLabel('Menge von Hackfleisch');
  await expect(menge).toHaveValue('500');

  // Typed on while a save runs: the later input is saved after it, not reset by its answer
  await page.route('**/api/essensplanung/planung/gericht-zutaten/*', async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await menge.fill('750');
  await menge.press('Enter');
  await menge.fill('900');
  await page.getByRole('heading', { name: 'E2E Zeilen sicher' }).click();
  await expect(menge).toHaveValue('900');
  await page.waitForTimeout(4000);
  await page.unroute('**/api/essensplanung/planung/gericht-zutaten/*');
  await expect(gericht.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByText('Gulasch', { exact: true }).click();
  await expect(menge).toHaveValue('900');

  // A read-only phase, e.g. maintenance, keeps a started new line
  const wartung = async (an: boolean): Promise<void> => {
    await page.unroute('**/api/essensplanung/planung/stand?*');
    await page.route('**/api/essensplanung/planung/stand?*', async (route) => {
      const url = route
        .request()
        .url()
        .replace(/seit=[^&]*/, 'seit=0');
      const antwort = await route.fetch({ url });
      const json = await antwort.json();
      if (json.ansicht) json.ansicht.wartung = an;
      await route.fulfill({ response: antwort, json });
    });
  };
  await zutat.pressSequentially('Zwieb');
  await gericht.getByLabel('Hinweis zur neuen Zutat').fill('rot');
  await wartung(true);
  await expect(zutat).toHaveCount(0, { timeout: 15_000 });
  await wartung(false);
  await expect(zutat).toHaveValue('Zwieb', { timeout: 15_000 });
  await expect(gericht.getByLabel('Hinweis zur neuen Zutat')).toHaveValue('rot');
  await page.unroute('**/api/essensplanung/planung/stand?*');

  // Removing right after typing removes without a conflict of its own save
  await menge.fill('1000');
  await gericht.getByRole('button', { name: 'Hackfleisch entfernen' }).click();
  await answerConfirm(page, 'Hackfleisch entfernen?', 'Entfernen');
  await expect(page.getByText('Hackfleisch entfernt.').first()).toBeVisible();
  await expect(menge).toHaveCount(0);
});

test('Enter in the name adds a chosen ingredient; saved text and amounts are not a conflict', async ({
  page,
}) => {
  test.slow();
  await anlegen(page, 'E2E Zeilen Enter');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Gulasch');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Gulasch angelegt.').first()).toBeVisible();
  const gericht = page.locator('li', { has: page.getByText('Gulasch', { exact: true }) }).first();

  // The first Enter takes the suggestion, the second adds the line without an amount
  const zutat = gericht.getByLabel('Neue Zutat für Gulasch');
  await zutat.pressSequentially('Hackfl');
  await zutat.press('Enter');
  await expect(zutat).toHaveValue('Hackfleisch');
  await expect(gericht.getByLabel('Menge von Hackfleisch')).toHaveCount(0);
  await zutat.press('Enter');
  await expect(gericht.getByLabel('Menge von Hackfleisch')).toHaveValue('');
  await expect(gericht.getByLabel('Menge von Hackfleisch')).toHaveCount(1);
  await expect(zutat).toHaveValue('');
  await expect(zutat).toBeFocused();

  // Saved as the server keeps it (single spaces, three decimals): typing on is no conflict
  const menge = gericht.getByLabel('Menge von Hackfleisch');
  await page.route('**/api/essensplanung/planung/gericht-zutaten/*', async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await gericht.getByLabel('Hinweis zu Hackfleisch').fill('mit  Schale');
  await menge.fill('0,7505');
  await menge.press('Enter');
  await menge.fill('800');
  await expect(page.getByText('Hackfleisch gespeichert.').first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(gericht.getByRole('alert')).toHaveCount(0);
  await page.getByRole('heading', { name: 'E2E Zeilen Enter' }).click();
  await expect(page.getByText('Hackfleisch gespeichert.').first()).toBeVisible({
    timeout: 10_000,
  });
  await page.unrouteAll({ behavior: 'wait' });
  await expect(gericht.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByText('Gulasch', { exact: true }).click();
  await expect(menge).toHaveValue('800');
  await expect(gericht.getByLabel('Hinweis zu Hackfleisch')).toHaveValue('mit Schale');
});

test('on a touch screen one tap outside saves the row and still does what it tapped', async ({
  page,
  hasTouch,
}) => {
  test.skip(!hasTouch, 'needs a touch screen');
  test.slow();
  await anlegen(page, 'E2E Zeilen Tippen');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Gulasch');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Gulasch angelegt.').first()).toBeVisible();
  const gericht = page.locator('li', { has: page.getByText('Gulasch', { exact: true }) }).first();
  const zutat = gericht.getByLabel('Neue Zutat für Gulasch');
  for (const [name, menge] of [
    ['Hackfl', '500'],
    ['Zwiebeln', '3'],
  ]) {
    await zutat.pressSequentially(name);
    await zutat.press('Enter');
    await gericht.getByLabel('Menge der neuen Zutat').fill(menge);
    await gericht.getByLabel('Menge der neuen Zutat').press('Enter');
    await expect(zutat).toHaveValue('');
  }
  const menge = gericht.getByLabel('Menge von Hackfleisch');

  // One tap on the page outside the row saves it
  await menge.fill('700');
  await page.getByRole('heading', { name: 'E2E Zeilen Tippen' }).tap();
  await expect(page.getByText('Hackfleisch gespeichert.').first()).toBeVisible({
    timeout: 10_000,
  });

  // One tap on a button of another row saves this one and moves that one
  await menge.fill('800');
  await gericht.getByRole('button', { name: 'Zwiebeln nach oben' }).tap();
  await expect(gericht.locator('ol > li').first()).toContainText('Zwiebeln', { timeout: 10_000 });
  await page.reload();
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByText('Gulasch', { exact: true }).click();
  await expect(menge).toHaveValue('800');
});
