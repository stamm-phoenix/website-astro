import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';
import { anlegen, pdfLaden, zeilenMenge } from './essensplanung-helpers';

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
  await chili.getByRole('button', { name: 'Mehr Angaben …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Zutat für Chili' });
  await dialog.getByLabel('Zutat', { exact: true }).fill('Hackfl');
  await dialog.getByRole('option', { name: 'Hackfleisch' }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('1,5');
  await dialog.getByLabel('Einheit', { exact: true }).selectOption('kg');
  await dialog.getByLabel('vegetarisch', { exact: true }).uncheck();
  await dialog.getByLabel('vegan', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect.poll(() => zeilenMenge(chili, 'Hackfleisch')).toBe('1,5 kg');
  await expect(chili.getByText('nur mit allem')).toBeVisible();
  await expect(
    chili.getByText('Für vegetarisch Essende gibt es in diesem Gericht keine Zutat.')
  ).toBeVisible();

  // An ingredient of the Planung's own, without an amount
  await chili.getByRole('button', { name: 'Mehr Angaben …' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Omas Chiligewürz');
  await dialog.getByRole('button', { name: 'Als eigene Zutat dieser Planung anlegen' }).click();
  await dialog.getByLabel('Kategorie', { exact: true }).selectOption({ label: 'Gewürz' });
  await dialog.getByLabel('Gemessen in', { exact: true }).selectOption({ label: 'Gewicht (g/kg)' });
  await dialog.getByLabel('Ernährung', { exact: true }).selectOption('vegan');
  await dialog.getByRole('checkbox', { name: 'Sellerie' }).check();
  await dialog.getByLabel('Hinweis (optional)').fill('nach Geschmack');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(chili.getByText('Omas Chiligewürz')).toBeVisible();
  await expect(chili.getByLabel('Hinweis zu Omas Chiligewürz')).toHaveValue('nach Geschmack');
  await expect(chili.getByText('enthält Sellerie')).toBeVisible();
  await expect(chili.getByText(/Für vegetarisch Essende/)).toHaveCount(0);

  // Instructions and tools; the other window sees them
  // Formatted text: bold appears bold on the recipe card
  const anleitung = chili.getByLabel('Anleitung (optional)');
  await anleitung.fill('Hack anbraten, ');
  await anleitung.press('ControlOrMeta+b');
  await anleitung.pressSequentially('würzen');
  await chili.getByLabel('Werkzeuge (optional)').fill('Großer Topf');
  await chili.getByLabel('Werkzeuge (optional)').press('Enter');
  // An empty link is left out; the missing address shows at its own line
  await chili.getByRole('button', { name: 'Link hinzufügen' }).click();
  await chili.getByRole('button', { name: 'Link hinzufügen' }).click();
  await chili.getByLabel('Titel (optional)').nth(1).fill('Originalrezept');
  await chili.getByRole('button', { name: 'Gericht speichern' }).click();
  const adressen = chili.getByLabel('Adresse', { exact: true });
  await expect(adressen.nth(1)).toHaveAttribute('aria-invalid', 'true');
  await expect(adressen.nth(0)).not.toHaveAttribute('aria-invalid', 'true');
  await adressen.nth(1).fill('https://example.org/chili');
  await chili.getByRole('button', { name: 'Gericht speichern' }).click();
  await expect(page.getByText('Chili gespeichert.').first()).toBeVisible();
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText('Chili', { exact: true }).click();
  await expect(anderes.getByLabel('Anleitung (optional)')).toContainText('Hack anbraten', {
    timeout: 15_000,
  });
  await expect(anderes.getByText('Omas Chiligewürz').first()).toBeVisible();

  // Lines move and go
  await chili.getByRole('button', { name: 'Omas Chiligewürz nach oben' }).click();
  await expect(chili.locator('ol > li').first()).toContainText('Omas Chiligewürz');
  await chili.getByRole('button', { name: 'Hackfleisch entfernen' }).click();
  await answerConfirm(page, 'Hackfleisch entfernen?', 'Entfernen');
  await expect(chili.getByLabel('Menge von Hackfleisch')).toHaveCount(0);

  // The recipe card downloads as PDF with the instructions; paper has no links, so the
  // address follows the title
  const karte = await pdfLaden(page, () =>
    chili.getByRole('button', { name: 'Rezeptkarte als PDF: Chili' }).click()
  );
  expect(karte.name).toBe('Rezeptkarte Chili.pdf');
  expect(karte.text).toContain('würzen');
  expect(karte.text).toContain('https://example.org/chili');
  expect(karte.text).toContain('Omas Chiligewürz');
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
  await expect(leser.getByRole('button', { name: 'Mehr Angaben …' })).toHaveCount(0);
  await expect(leser.getByLabel('Neues Gericht')).toHaveCount(0);
  await leser.context().close();
});

test('an open line keeps its version, a deleted one is not added again; closing asks', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E Zeilenkonflikt');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Kakao');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Kakao angelegt.').first()).toBeVisible();
  const kakao = page.locator('li', { has: page.getByText('Kakao', { exact: true }) }).first();
  await kakao.getByRole('button', { name: 'Mehr Angaben …' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Zutat', { exact: true }).fill('H-Milch');
  await dialog.getByRole('option', { name: 'H-Milch', exact: true }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('200');
  // While saving the fields are locked, so nothing typed meanwhile gets lost
  await page.route('**/api/essensplanung/planung/gerichte/*/zutaten', async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog.getByLabel('Menge', { exact: true })).toBeDisabled();
  await expect.poll(() => zeilenMenge(kakao, 'H-Milch')).toBe('200 ml');
  await page.unroute('**/api/essensplanung/planung/gerichte/*/zutaten');

  // Closing with unsaved input asks first
  await kakao.getByRole('button', { name: 'H-Milch ändern' }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('250');
  await page.keyboard.press('Escape');
  const frage = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
  await expect(frage).toBeVisible();
  await frage.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog.getByLabel('Menge', { exact: true })).toHaveValue('250');

  // Someone else changes the line meanwhile: saving the old form is a conflict
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText('Kakao', { exact: true }).click();
  await anderes.getByRole('button', { name: 'H-Milch ändern' }).click();
  await anderes.getByRole('dialog').getByLabel('Hinweis (optional)').fill('warm');
  await anderes.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(anderes.getByLabel('Hinweis zu H-Milch')).toHaveValue('warm');
  await expect(kakao.getByLabel('Hinweis zu H-Milch')).toHaveValue('warm', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText(/Jemand anderes hat das gerade geändert/).first()).toBeVisible();
  await expect(kakao.getByLabel('Hinweis zu H-Milch')).toHaveValue('warm');
  await expect(dialog.getByLabel('Menge', { exact: true })).toHaveValue('250');

  // The line is deleted meanwhile: saving does not add it again
  await anderes.getByRole('button', { name: 'H-Milch entfernen' }).click();
  await answerConfirm(anderes, 'H-Milch entfernen?', 'Entfernen');
  await expect(kakao.getByText('Noch keine Zutaten.')).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeVisible();
  await expect(kakao.getByText('Noch keine Zutaten.')).toBeVisible();
  await anderes.context().close();
});

test('a dish deleted by someone else shows the unsaved input', async ({ page, browser }) => {
  await anlegen(page, 'E2E Gericht weg');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Waffeln');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Waffeln angelegt.').first()).toBeVisible();
  const waffeln = page.locator('li', { has: page.getByText('Waffeln', { exact: true }) }).first();
  await waffeln.getByLabel('Notiz (optional)').fill('Eisen vorheizen');
  // A tool typed but not yet added counts as input too
  await waffeln.getByLabel('Werkzeuge (optional)').fill('Waffeleisen');
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText('Waffeln', { exact: true }).click();
  await anderes.getByRole('button', { name: 'Gericht löschen' }).click();
  await answerConfirm(anderes, '„Waffeln“ löschen?', 'Gericht löschen');
  await expect(anderes.getByText('Waffeln gelöscht.').first()).toBeVisible();
  await page.bringToFront();
  await expect(
    page
      .getByText(
        '„Waffeln“ wurde gerade gelöscht. Deine ungespeicherten Eingaben: Notiz: Eisen vorheizen · Werkzeuge: Waffeleisen'
      )
      .first()
  ).toBeVisible({ timeout: 15_000 });
  await anderes.context().close();
});

test('drained weight is marked; a typed unit stays when others change the ingredient', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E Einheiten');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Eintopf');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Eintopf angelegt.').first()).toBeVisible();
  const eintopf = page.locator('li', { has: page.getByText('Eintopf', { exact: true }) }).first();
  const dialog = page.getByRole('dialog');

  // Tins are weighed drained
  await eintopf.getByRole('button', { name: 'Mehr Angaben …' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Kidneyb');
  await dialog.getByRole('option', { name: 'Kidneybohnen' }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('2');
  await dialog.getByLabel('Einheit', { exact: true }).selectOption('kg');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect.poll(() => zeilenMenge(eintopf, 'Kidneybohnen')).toBe('2 kg (ATG)');

  // An own ingredient without an amount
  await eintopf.getByRole('button', { name: 'Mehr Angaben …' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Hausbrühe');
  await dialog.getByRole('button', { name: 'Als eigene Zutat dieser Planung anlegen' }).click();
  await dialog.getByLabel('Kategorie', { exact: true }).selectOption({ label: 'Gewürz' });
  await dialog.getByLabel('Gemessen in', { exact: true }).selectOption({ label: 'Volumen (ml/l)' });
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(eintopf.getByText('Hausbrühe')).toBeVisible();

  // A types 1,5 l while B measures the ingredient in packs: the unit is not turned into packs
  await eintopf.getByRole('button', { name: 'Hausbrühe ändern' }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('1,5');
  await dialog.getByLabel('Einheit', { exact: true }).selectOption('l');
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText(/Zutaten dieser Planung/).click();
  await anderes.getByRole('button', { name: 'Hausbrühe ändern' }).click();
  await anderes
    .getByRole('dialog')
    .getByLabel('Gemessen in', { exact: true })
    .selectOption({ label: 'Packung' });
  await anderes.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(anderes.getByText('Hausbrühe gespeichert.').first()).toBeVisible();
  await expect(dialog.getByText(/inzwischen auf „Packung“ umgestellt/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(dialog.getByLabel('Einheit', { exact: true })).toHaveValue('l');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeVisible();
  await expect(eintopf.getByText(/1,5/)).toHaveCount(0);
  await anderes.context().close();
});

test('without the central list the card does not hide allergens', async ({ page }) => {
  await anlegen(page, 'E2E Allergene');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Milchreis');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Milchreis angelegt.').first()).toBeVisible();
  const reis = page.locator('li', { has: page.getByText('Milchreis', { exact: true }) }).first();
  await reis.getByRole('button', { name: 'Mehr Angaben …' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Zutat', { exact: true }).fill('H-Milch');
  await dialog.getByRole('option', { name: 'H-Milch', exact: true }).click();
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(reis.getByText(/enthält Milch/)).toBeVisible();

  await page.route('**/api/essensplanung/planung/katalog', (route) => route.abort());
  await page.reload();
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByText('Milchreis', { exact: true }).click();
  await expect(reis.getByText('enthält Allergene (Namen nicht geladen)')).toBeVisible();
  await expect(reis.getByRole('button', { name: 'Rezeptkarte als PDF: Milchreis' })).toBeDisabled();
});

test('a dish changed during the delete question is not deleted', async ({ page, browser }) => {
  await anlegen(page, 'E2E Löschkonflikt');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Suppe');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Suppe angelegt.').first()).toBeVisible();
  const suppe = page.locator('li[id^="gericht-"]').first();
  await suppe.getByRole('button', { name: 'Gericht löschen' }).click();
  await expect(page.getByRole('dialog', { name: '„Suppe“ löschen?' })).toBeVisible();

  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText('Suppe', { exact: true }).click();
  await anderes
    .locator('li[id^="gericht-"]')
    .getByLabel('Name', { exact: true })
    .fill('Kürbissuppe');
  await anderes.getByRole('button', { name: 'Gericht speichern' }).click();
  await expect(anderes.getByText('Kürbissuppe gespeichert.').first()).toBeVisible();
  await expect(suppe.getByText('Kürbissuppe', { exact: true })).toBeAttached({ timeout: 15_000 });

  await answerConfirm(page, '„Suppe“ löschen?', 'Gericht löschen');
  await expect(page.getByText(/Jemand anderes hat das gerade geändert/).first()).toBeVisible();
  await expect(suppe.getByText('Kürbissuppe', { exact: true })).toBeVisible();

  // A line added during the question counts as a change too
  await suppe.getByRole('button', { name: 'Gericht löschen' }).click();
  await expect(page.getByRole('dialog', { name: '„Kürbissuppe“ löschen?' })).toBeVisible();
  await anderes.getByRole('button', { name: 'Mehr Angaben …' }).click();
  const dialog = anderes.getByRole('dialog');
  await dialog.getByLabel('Zutat', { exact: true }).fill('H-Milch');
  await dialog.getByRole('option', { name: 'H-Milch', exact: true }).click();
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(anderes.getByText('H-Milch').first()).toBeVisible();
  await expect(suppe.getByText('1 Zutaten', { exact: false })).toBeAttached({ timeout: 15_000 });
  await answerConfirm(page, '„Kürbissuppe“ löschen?', 'Gericht löschen');
  await expect(page.getByText(/Jemand anderes hat das gerade geändert/).first()).toBeVisible();
  await expect(suppe.getByText('Kürbissuppe', { exact: true })).toBeVisible();
  await anderes.context().close();
});

test('spoons and pieces are converted to grams from the list', async ({ page }) => {
  await anlegen(page, 'E2E Umrechnung');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Rührkuchen');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Rührkuchen angelegt.').first()).toBeVisible();
  const kuchen = page.locator('li', { has: page.getByText('Rührkuchen', { exact: true }) }).first();
  await kuchen.getByRole('button', { name: 'Mehr Angaben …' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Zutat', { exact: true }).fill('Butter');
  await dialog.getByRole('option', { name: 'Butter', exact: true }).click();
  // The measure shown is the one calculated with
  await expect(dialog.getByLabel('Maß zum Umrechnen')).toHaveValue('tl');
  await expect(dialog.getByText('≈ 5 g')).toBeVisible();
  await dialog.getByLabel('Anzahl zum Umrechnen').fill('2');
  await dialog.getByLabel('Maß zum Umrechnen').selectOption({ label: 'EL' });
  await expect(dialog.getByText('≈ 30 g')).toBeVisible();
  await dialog.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(dialog.getByLabel('Menge', { exact: true })).toHaveValue('30');
  await expect(dialog.getByLabel('Einheit', { exact: true })).toHaveValue('g');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect.poll(() => zeilenMenge(kuchen, 'Butter')).toBe('30 g');

  // Pieces of onions; nothing to convert for milk, which is measured in ml
  await kuchen.getByRole('button', { name: 'Mehr Angaben …' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Butter');
  await dialog.getByRole('option', { name: 'Butter', exact: true }).click();
  await dialog.getByLabel('Maß zum Umrechnen').selectOption({ label: 'EL' });
  await dialog.getByLabel('Zutat', { exact: true }).fill('Zwiebeln');
  await dialog.getByRole('option', { name: 'Zwiebeln', exact: true }).click();
  // Onions only have pieces: the measure follows
  await expect(dialog.getByLabel('Maß zum Umrechnen')).toHaveValue('stueck');
  await dialog.getByLabel('Anzahl zum Umrechnen').fill('3');
  await expect(dialog.getByText('≈ 249 g')).toBeVisible();
  await dialog.getByLabel('Zutat', { exact: true }).fill('H-Milch');
  await dialog.getByRole('option', { name: 'H-Milch', exact: true }).click();
  await expect(dialog.getByLabel('Anzahl zum Umrechnen')).toHaveCount(0);
});

test('typed text stays as typed, Enter takes the first suggestion; discarding says nothing', async ({
  page,
}) => {
  await anlegen(page, 'E2E Vorschläge');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Salat');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Salat angelegt.').first()).toBeVisible();
  const salat = page.locator('li', { has: page.getByText('Salat', { exact: true }) }).first();
  const dialog = page.getByRole('dialog');
  // „Ol“ is not „Öl“: the text stays, and Enter takes the best suggestion
  await salat.getByRole('button', { name: 'Mehr Angaben …' }).click();
  const feld = dialog.getByLabel('Zutat', { exact: true });
  await feld.pressSequentially('Ol');
  await expect(feld).toHaveValue('Ol');
  await expect(dialog.getByRole('option').first()).toHaveText('Oliven');
  await feld.press('Enter');
  await expect(feld).toHaveValue('Oliven');
  await expect(dialog).toBeVisible();

  // Discarding the new line closes without a message about a deleted dish
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Verwerfen');
  await expect(dialog).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(page.getByText(/das Gericht wurde gelöscht/)).toHaveCount(0);
});

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
  await gericht.getByLabel('Einheit von Hackfleisch').selectOption('kg');
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
  await gericht.getByLabel('Einheit der neuen Zutat').selectOption('kg');
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
