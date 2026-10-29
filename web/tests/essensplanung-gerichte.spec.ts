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
