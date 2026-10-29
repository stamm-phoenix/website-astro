import { test, expect, answerConfirm } from './fixtures';
import { anlegen, pdfLaden } from './essensplanung-helpers';

test('a change of others is only saved over with Enter; a cancelled removal still guards', async ({
  page,
  browser,
}) => {
  test.slow();
  await anlegen(page, 'E2E Zeilen Konflikt');
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

  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText('Gulasch', { exact: true }).click();
  const andereMenge = anderes.getByLabel('Menge von Hackfleisch');

  // Typed while others save: Enter warns, leaving the row keeps theirs, a second Enter saves
  await menge.fill('600');
  await andereMenge.fill('750');
  const fremd = anderes.waitForResponse(
    (antwort) =>
      antwort.url().includes('/gericht-zutaten/') && antwort.request().method() === 'PATCH'
  );
  await andereMenge.press('Enter');
  expect((await fremd).ok()).toBe(true);
  await page.waitForTimeout(5_000);
  await menge.press('Enter');
  await expect(gericht.getByRole('alert')).toContainText('Jemand anderes hat Hackfleisch');
  await page.getByRole('heading', { name: 'E2E Zeilen Konflikt' }).click();
  await page.waitForTimeout(2_000);
  await anderes.reload();
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText('Gulasch', { exact: true }).click();
  await expect(andereMenge).toHaveValue('750');
  await expect(menge).toHaveValue('600');
  await menge.press('Enter');
  await expect(andereMenge).toHaveValue('600', { timeout: 15_000 });

  // After „Abbrechen“ the row guards its input again when others remove it
  await gericht.getByRole('button', { name: 'Hackfleisch entfernen' }).click();
  await answerConfirm(page, 'Hackfleisch entfernen?', 'Abbrechen');
  await menge.fill('1200');
  await anderes.getByRole('button', { name: 'Hackfleisch entfernen' }).click();
  await answerConfirm(anderes, 'Hackfleisch entfernen?', 'Entfernen');
  await expect(
    page.getByText(/Hackfleisch wurde gerade entfernt \(deine Eingabe: 1200 g/).first()
  ).toBeVisible({ timeout: 20_000 });
});

test('an amount typed for one ingredient does not go to another one others chose', async ({
  page,
  browser,
}) => {
  test.slow();
  await anlegen(page, 'E2E Zeilen Zutat');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Eintopf');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Eintopf angelegt.').first()).toBeVisible();
  const gericht = page.locator('li', { has: page.getByText('Eintopf', { exact: true }) }).first();

  // Tins show their drained weight already in the new row
  const zutat = gericht.getByLabel('Neue Zutat für Eintopf');
  await zutat.pressSequentially('Kidneyb');
  await zutat.press('Enter');
  await expect(gericht.getByLabel('Einheit der neuen Zutat').locator('option').first()).toHaveText(
    'g (ATG)'
  );
  await gericht.getByLabel('Menge der neuen Zutat').fill('500');
  await gericht.getByLabel('Menge der neuen Zutat').press('Enter');
  await expect(page.getByText('Kidneybohnen hinzugefügt.').first()).toBeVisible();
  const menge = gericht.getByLabel('Menge von Kidneybohnen');

  // Others swap the ingredient of the line: leaving the row saves nothing, Enter warns
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText('Eintopf', { exact: true }).click();
  await menge.fill('600');
  await anderes.getByRole('button', { name: 'Kidneybohnen ändern' }).click();
  const dialog = anderes.getByRole('dialog');
  await dialog.getByLabel('Zutat', { exact: true }).fill('Zwiebeln');
  await dialog.getByRole('option', { name: 'Zwiebeln', exact: true }).click();
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(gericht.getByLabel('Menge von Zwiebeln')).toBeVisible({ timeout: 15_000 });
  await gericht.getByLabel('Menge von Zwiebeln').press('Enter');
  await expect(gericht.getByRole('alert')).toContainText('die Zutat gerade zu Zwiebeln');
  await page.getByRole('heading', { name: 'E2E Zeilen Zutat' }).click();
  await page.waitForTimeout(2_000);
  await anderes.reload();
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText('Eintopf', { exact: true }).click();
  await expect(anderes.getByLabel('Menge von Zwiebeln')).not.toHaveValue('600');
});

test('a row saves before it moves, keeps decimal amounts and warns about changes in the answer', async ({
  page,
}) => {
  test.slow();
  await anlegen(page, 'E2E Zeilen Reihenfolge');
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
  const patches: string[] = [];
  page.on('request', (anfrage) => {
    if (anfrage.method() === 'PATCH' && anfrage.url().includes('/gericht-zutaten/'))
      patches.push(anfrage.postData() ?? '');
  });

  // Typed, then moved: the amount is saved first, the move goes after it without a conflict
  await page.route('**/api/essensplanung/planung/gericht-zutaten/*', async (route) => {
    await new Promise((done) => setTimeout(done, 1000));
    await route.continue();
  });
  await menge.fill('600');
  await gericht.getByRole('button', { name: 'Hackfleisch nach unten' }).click();
  await page.getByRole('heading', { name: 'E2E Zeilen Reihenfolge' }).click();
  await expect(gericht.locator('ol > li').last()).toContainText('Hackfleisch', {
    timeout: 15_000,
  });
  await page.unroute('**/api/essensplanung/planung/gericht-zutaten/*');
  await expect(gericht.getByRole('alert')).toHaveCount(0);
  await expect(menge).toHaveValue('600');

  // Typed, then a tap on a button of another row: one tap moves that row and saves this one
  await page.route('**/api/essensplanung/planung/gericht-zutaten/*', async (route) => {
    await new Promise((done) => setTimeout(done, 1000));
    await route.continue();
  });
  await menge.fill('650');
  await gericht.getByRole('button', { name: 'Zwiebeln nach unten' }).click();
  await expect(gericht.locator('ol > li').last()).toContainText('Zwiebeln', { timeout: 15_000 });
  await expect(page.getByText('Hackfleisch gespeichert.').first()).toBeVisible({
    timeout: 15_000,
  });
  await page.unroute('**/api/essensplanung/planung/gericht-zutaten/*');
  await expect(menge).toHaveValue('650');

  // „1.5“ is saved once and then counts as saved, though shown as „1,5“ elsewhere
  await menge.fill('1.5');
  await menge.press('Enter');
  await expect(page.getByText('Hackfleisch gespeichert.').first()).toBeVisible();
  const anzahl = patches.length;
  await menge.press('Enter');
  await page.waitForTimeout(1000);
  expect(patches.length).toBe(anzahl);

  // The answer of a save already holds a change of others: typed input is not saved over it
  await page.route('**/api/essensplanung/planung/gericht-zutaten/*', async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    const antwort = await route.fetch();
    const json = await antwort.json();
    const ansicht = json.ansicht ?? json;
    for (const g of ansicht.gerichte) for (const z of g.zutaten) if (z.menge === 750) z.menge = 900;
    await route.fulfill({ response: antwort, json });
  });
  await menge.fill('750');
  await menge.press('Enter');
  await menge.fill('800');
  await expect(gericht.getByRole('alert')).toContainText('Jemand anderes hat Hackfleisch', {
    timeout: 10_000,
  });
  await page.unroute('**/api/essensplanung/planung/gericht-zutaten/*');
  const vorher = patches.length;
  await page.getByRole('heading', { name: 'E2E Zeilen Reihenfolge' }).click();
  await page.waitForTimeout(1500);
  expect(patches.length).toBe(vorher);
  await expect(menge).toHaveValue('800');
});

test('a fixed amount set by others is a conflict; PDF and deleting wait for the row', async ({
  page,
  browser,
}) => {
  test.slow();
  await anlegen(page, 'E2E Zeilen Fest');
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

  // Others make the amount fixed while it is typed: the row warns instead of saving
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText('Gulasch', { exact: true }).click();
  await menge.fill('600');
  await anderes.getByRole('button', { name: 'Hackfleisch ändern' }).click();
  const dialog = anderes.getByRole('dialog');
  await dialog.getByLabel('Feste Menge').check();
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(gericht.getByText('feste Menge')).toBeVisible({ timeout: 15_000 });
  await menge.press('Enter');
  await expect(gericht.getByRole('alert')).toContainText('Jemand anderes hat Hackfleisch');
  await menge.press('Escape');
  await expect(menge).toHaveValue('500');

  // The PDF right after typing shows what was typed
  await menge.fill('650');
  const karte = await pdfLaden(page, () =>
    gericht.getByRole('button', { name: 'Rezeptkarte als PDF: Gulasch' }).click()
  );
  expect(karte.text).toContain('650 g');

  // Deleting the dish right after typing asks with the saved version: no conflict of its own
  await menge.fill('700');
  await gericht.getByRole('button', { name: 'Gericht löschen' }).click();
  await answerConfirm(page, '„Gulasch“ löschen?', 'Gericht löschen');
  await expect(page.getByText('Gulasch gelöscht.').first()).toBeVisible();
});

test('an amount of 0 is refused; a PDF waits for a failed save and is not made', async ({
  page,
}) => {
  await anlegen(page, 'E2E Zeilen Fehler');
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

  // 0 is no amount: the server refuses it and the input stays
  await menge.fill('0');
  await menge.press('Enter');
  await expect(gericht.getByRole('alert')).toBeVisible();
  await expect(menge).toHaveValue('0');

  // A failed save stops the PDF instead of making it with the old amount
  await menge.fill('750');
  await page.route('**/api/essensplanung/planung/gericht-zutaten/*', (route) =>
    route.fulfill({ status: 500, body: '{}' })
  );
  let heruntergeladen = false;
  page.on('download', () => (heruntergeladen = true));
  await gericht.getByRole('button', { name: 'Rezeptkarte als PDF: Gulasch' }).click();
  await expect(page.getByText(/das PDF wurde nicht erstellt/).first()).toBeVisible();
  expect(heruntergeladen).toBe(false);
  await expect(menge).toHaveValue('750');
  await page.unrouteAll({ behavior: 'wait' });

  // An amount refused right away in the row stops the PDF too
  await menge.fill('abc');
  await gericht.getByRole('button', { name: 'Rezeptkarte als PDF: Gulasch' }).click();
  await expect(gericht.getByRole('alert')).toBeVisible();
  await expect(page.getByText(/das PDF wurde nicht erstellt/).first()).toBeVisible();
  expect(heruntergeladen).toBe(false);
});

test('a conflict is settled with buttons, without Enter or Escape', async ({ page, browser }) => {
  test.slow();
  await anlegen(page, 'E2E Zeilen Knöpfe');
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

  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText('Gulasch', { exact: true }).click();
  const andereMenge = anderes.getByLabel('Menge von Hackfleisch');
  /** Others save `wert` while the row holds `eigene`, then the row tries to save. */
  const konflikt = async (eigene: string, wert: string) => {
    await menge.fill(eigene);
    await andereMenge.fill(wert);
    await andereMenge.press('Enter');
    await expect(andereMenge).toHaveValue(wert);
    await page.waitForTimeout(4_000);
    await page.getByRole('heading', { name: 'E2E Zeilen Knöpfe' }).click();
    await expect(gericht.getByRole('alert')).toContainText('Jemand anderes hat Hackfleisch');
  };

  // „Verwerfen“ takes theirs
  await konflikt('600', '750');
  await gericht.getByRole('button', { name: 'Hackfleisch: Eingabe verwerfen' }).click();
  await expect(menge).toHaveValue('750');
  await expect(gericht.getByRole('alert')).toHaveCount(0);

  // „Trotzdem speichern“ saves over theirs
  await konflikt('900', '800');
  await gericht.getByRole('button', { name: 'Hackfleisch: trotzdem speichern' }).click();
  await expect(gericht.getByRole('alert')).toHaveCount(0);
  await expect(andereMenge).toHaveValue('900', { timeout: 15_000 });
  await anderes.context().close();
});

test('a new row follows an ingredient of the list that others take over and measure anew', async ({
  page,
  browser,
}) => {
  test.slow();
  await anlegen(page, 'E2E Zeilen Übernahme');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Pfannkuchen');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Pfannkuchen angelegt.').first()).toBeVisible();
  const gericht = page
    .locator('li', { has: page.getByText('Pfannkuchen', { exact: true }) })
    .first();

  // A picks syrup of the list and types 1,5 l, not added yet
  const zutat = gericht.getByLabel('Neue Zutat für Pfannkuchen');
  await zutat.pressSequentially('Ahornsir');
  await zutat.press('Enter');
  await gericht.getByLabel('Menge der neuen Zutat').fill('1,5');
  const einheit = gericht.getByLabel('Einheit der neuen Zutat');
  await einheit.selectOption('l');

  // B adds it without an amount and measures it in packs for this Planung
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText('Pfannkuchen', { exact: true }).click();
  const andereZutat = anderes.getByLabel('Neue Zutat für Pfannkuchen');
  await andereZutat.pressSequentially('Ahornsir');
  await andereZutat.press('Enter');
  await andereZutat.press('Enter');
  await expect(anderes.getByLabel('Menge von Ahornsirup')).toBeVisible();
  await anderes.getByText(/Zutaten dieser Planung/).click();
  await anderes
    .getByRole('group')
    .filter({ hasText: 'Zutaten dieser Planung' })
    .getByRole('button', { name: 'Ahornsirup ändern' })
    .click();
  await anderes
    .getByRole('dialog')
    .getByLabel('Gemessen in', { exact: true })
    .selectOption({ label: 'Packung' });
  await anderes.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(anderes.getByText('Ahornsirup gespeichert.').first()).toBeVisible();

  // A's row now offers packs; the typed litres stay until changed
  await expect(einheit.locator('option', { hasText: 'Packung' })).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(einheit).toHaveValue('l');
  await einheit.selectOption({ label: 'Packung' });
  await einheit.press('Enter');
  await expect(gericht.getByLabel('Einheit von Ahornsirup').nth(1)).toHaveValue('packung');
  await page.reload();
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByText('Pfannkuchen', { exact: true }).click();
  await expect(page.getByLabel('Menge von Ahornsirup').nth(1)).toHaveValue('1,5');
  await expect(page.getByLabel('Einheit von Ahornsirup').nth(1)).toHaveValue('packung');
  await anderes.context().close();
});
