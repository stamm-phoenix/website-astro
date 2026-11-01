import type { Locator, Page } from '@playwright/test';
import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';
import { anlegen, pdfLaden } from './essensplanung-helpers';

/** Pasta for 4 (500 g), eaten by 8 at lunch on both days: 1 kg each. */
async function nudelnPlanen(page: Page, name: string): Promise<void> {
  await anlegen(page, name);
  const dialog = page.getByRole('dialog');
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill('Nudeln');
  await page.getByLabel('Personen', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Nudeln angelegt.').first()).toBeVisible();
  const nudeln = page.locator('li', { has: page.getByText('Nudeln', { exact: true }) }).first();
  const zutat = nudeln.getByLabel('Neue Zutat für Nudeln');
  await zutat.pressSequentially('Nudeln (Spag');
  await zutat.press('Enter');
  await nudeln.getByLabel('Menge der neuen Zutat').fill('500');
  await nudeln.getByLabel('Menge der neuen Zutat').press('Enter');
  await expect(nudeln.getByLabel('Menge von Nudeln (Spaghetti)')).toHaveValue('500');

  await page.getByRole('tab', { name: 'Teilnehmende' }).click();
  await page.getByRole('button', { name: 'Teilnehmende hinzufügen' }).click();
  await dialog.getByLabel('Gruppe', { exact: true }).selectOption({ label: 'Pfadi' });
  await dialog.getByLabel('Anzahl').fill('8');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('tab', { name: 'Plan' }).click();
  for (const mahlzeit of ['1_2', '2_2']) {
    await page.getByRole('button', { name: `Gericht einplanen bei ${mahlzeit}` }).click();
    await dialog.getByLabel('Gericht', { exact: true }).selectOption({ label: 'Nudeln' });
    await dialog.getByRole('button', { name: 'Einplanen' }).click();
    await expect(dialog).toBeHidden();
  }
  await page.getByRole('tab', { name: 'Einkauf' }).click();
}

/** Adds a trip; `bis` is the index of the last meal in the choice (0: all meals). */
async function einkaufAnlegen(page: Page, name: string, bis: number): Promise<void> {
  await page.getByRole('button', { name: 'Einkauf anlegen' }).click();
  const form = page.getByRole('form', { name: 'Neuer Einkauf' });
  await form.getByLabel('Name des Einkaufs').fill(name);
  await form.getByLabel('Für die Mahlzeiten bis').selectOption({ index: bis });
  await form.getByRole('button', { name: 'Einkauf anlegen' }).click();
  await expect(page.getByText(`${name} angelegt.`).first()).toBeVisible();
}

/** A trip shown on its own. */
const karte = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

/** Back to the overview of the trips, if a trip is shown. */
async function uebersicht(page: Page): Promise<void> {
  const zurueck = page.getByRole('button', { name: 'Zurück zu den Einkäufen' });
  if (await zurueck.count()) await zurueck.click();
  await expect(page.getByRole('list', { name: 'Einkäufe' })).toBeVisible();
}

/** Opens a trip from the overview, to shop with or with its list to change. */
async function oeffnen(page: Page, name: string, modus: 'live' | 'liste' = 'live') {
  await uebersicht(page);
  await page.getByRole('button', { name: `${name}: Einkaufen` }).click();
  const einkauf = karte(page, name);
  await expect(einkauf).toBeVisible();
  if (modus === 'liste') await einkauf.getByRole('button', { name: 'Liste anpassen' }).click();
  return einkauf;
}

/** The box that ticks a thing off or takes the tick back. */
const box = (einkauf: Locator, name: string) =>
  einkauf.getByRole('checkbox', { name: `${name} abhaken` });

test('two shop at once in the live mode; a rest goes to the next trip and into the stock', async ({
  page,
  browser,
}) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe');
  await einkaufAnlegen(page, 'Montag', 2);
  await einkaufAnlegen(page, 'Mittwoch', 0);
  const reihe = page.getByRole('list', { name: 'Einkäufe' }).getByRole('listitem');
  await expect(reihe.first()).toContainText('bis 1_2 Mittagessen');
  await expect(reihe.first()).toContainText('0 von 1 abgehakt');

  const montag = await oeffnen(page, 'Montag', 'liste');
  await expect(page.getByRole('list', { name: 'Montag: Teigware' })).toContainText(
    '1 kg Nudeln (Spaghetti)'
  );
  // The trip is shown on its own; the browser's back button leads to the overview
  await expect(page.getByRole('table', { name: 'Einkaufsliste' })).toBeHidden();
  await page.goBack();
  await expect(page.getByRole('list', { name: 'Einkäufe' })).toBeVisible();
  await expect(page).toHaveURL(/#t=/);
  await page.goForward();
  await expect(montag).toBeVisible();
  const mittwoch = await oeffnen(page, 'Mittwoch', 'liste');
  await expect(page.getByRole('list', { name: 'Mittwoch: Teigware' })).toContainText(
    '1 kg Nudeln (Spaghetti)'
  );
  // Which dishes it is for, by the ID of the planned dish
  await mittwoch.getByRole('checkbox', { name: 'Für welche Gerichte' }).check();
  await expect(
    mittwoch.getByRole('list', { name: 'Für welche Gerichte: Nudeln (Spaghetti)' })
  ).toContainText(/Nudeln \(1_2_1\)\s*1 kg\s*Nudeln \(2_2_1\)\s*1 kg/);
  await mittwoch.getByRole('checkbox', { name: 'Für welche Gerichte' }).uncheck();
  await expectNoHorizontalOverflow(page);

  // Someone else opens the same trip in the live mode
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Einkauf' }).click();
  const dortMontag = await oeffnen(anderes, 'Montag');
  await expect(dortMontag.getByRole('status')).toHaveText('0 von 1 abgehakt');

  // Only 800 g, and wholegrain instead: typed in the row, Enter ticks it off
  await oeffnen(page, 'Montag');
  const menge = montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)');
  await expect(menge).toHaveValue('1');
  await menge.fill('0,8');
  const ersatz = montag.getByLabel('Ersatz für Nudeln (Spaghetti)');
  await ersatz.fill('Vollkornnudeln');
  await ersatz.press('Enter');
  await expect(montag.getByRole('status')).toHaveText('1 von 1 abgehakt');
  await expect(box(montag, 'Nudeln (Spaghetti)')).toHaveAttribute('aria-checked', 'true');
  await expect(montag).toContainText('800 g → Vollkornnudeln');
  await expectNoHorizontalOverflow(page);

  // The other one sees it without reloading
  await expect(dortMontag.getByRole('status')).toHaveText('1 von 1 abgehakt', {
    timeout: 15_000,
  });
  await expect(dortMontag).toContainText('Kim Küche');

  // The missing 200 g are bought on Wednesday; the stock has what was bought
  await oeffnen(page, 'Mittwoch', 'liste');
  await expect(page.getByRole('list', { name: 'Mittwoch: Teigware' })).toContainText(
    '1,2 kg Nudeln (Spaghetti)'
  );
  await uebersicht(page);
  const lager = page.getByRole('table', { name: 'Lager' });
  await expect(lager.getByRole('row', { name: /Nudeln \(Spaghetti\)/ })).toContainText(
    /→ Vollkornnudeln\s*0 g\s*800 g\s*0 g\s*800 g/
  );
  // The open shopping list is what is needed less the stock now
  await expect(page.getByRole('rowgroup', { name: 'Ohne Geschäft: Teigware' })).toContainText(
    /1,2 kg\s*Nudeln \(Spaghetti\)/
  );
  // The dish names the replacement
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByLabel('Mengen für 8 Portionen von Nudeln').first().click();
  await expect(page.getByRole('list', { name: 'Mengen für Nudeln bei 1_2' })).toContainText(
    'Nudeln (Spaghetti) → Vollkornnudeln'
  );
  await page.getByRole('tab', { name: 'Einkauf' }).click();

  // The other one ticks off Wednesday with one tap, then takes it back again
  const dortMittwoch = await oeffnen(anderes, 'Mittwoch');
  await box(dortMittwoch, 'Nudeln (Spaghetti)').click();
  await expect(dortMittwoch.getByRole('status')).toHaveText('1 von 1 abgehakt');
  await expect(reihe.nth(1)).toContainText('1 von 1 abgehakt', { timeout: 15_000 });
  await box(dortMittwoch, 'Nudeln (Spaghetti)').click();
  await expect(dortMittwoch.getByRole('status')).toHaveText('0 von 1 abgehakt');
  await anderes.context().close();

  // The trip as a PDF with a box per thing
  await oeffnen(page, 'Mittwoch', 'liste');
  const pdf = await pdfLaden(page, () =>
    mittwoch.getByRole('button', { name: 'Mittwoch als PDF' }).click()
  );
  expect(pdf.name).toContain('Mittwoch');
  expect(pdf.text).toContain('Nudeln (Spaghetti)');
  expect(pdf.text).toContain('1,2 kg');

  // Finishing Monday keeps what was bought
  await oeffnen(page, 'Montag');
  await montag.getByRole('button', { name: 'Montag abschließen' }).click();
  await expect(montag).toContainText('abgeschlossen');
  await expect(montag.getByRole('button', { name: 'Liste anpassen' })).toHaveCount(0);
  await oeffnen(page, 'Mittwoch', 'liste');
  await expect(page.getByRole('list', { name: 'Mittwoch: Teigware' })).toContainText(
    '1,2 kg Nudeln (Spaghetti)'
  );

  // Deleting it asks first; what was bought leaves the stock
  await uebersicht(page);
  await page.getByRole('button', { name: 'Montag', exact: true }).click();
  await montag.getByRole('button', { name: 'Montag löschen' }).click();
  await answerConfirm(page, 'Montag löschen?', 'Löschen');
  await expect(page.getByText('Montag gelöscht.').first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Einkäufe' })).toBeVisible();
  await oeffnen(page, 'Mittwoch', 'liste');
  await expect(page.getByRole('list', { name: 'Mittwoch: Teigware' })).toContainText(
    '2 kg Nudeln (Spaghetti)'
  );
});

test('things move to another trip or get a fixed amount by hand', async ({ page }) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Regeln');
  await einkaufAnlegen(page, 'Montag', 2);
  await einkaufAnlegen(page, 'Mittwoch', 0);
  const montag = await oeffnen(page, 'Montag', 'liste');

  // A fixed amount: 1,5 kg on Monday, so 500 g are left for Wednesday; Enter saves it
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti) in Montag anpassen' }).click();
  await montag.getByLabel('Einheit der festen Menge von Nudeln (Spaghetti)').selectOption('kg');
  await montag.getByLabel('Feste Menge von Nudeln (Spaghetti)').fill('1,5');
  await montag.getByLabel('Feste Menge von Nudeln (Spaghetti)').press('Enter');
  await expect(page.getByRole('list', { name: 'Montag: Teigware' })).toContainText(
    '1,5 kg Nudeln (Spaghetti) · feste Menge'
  );
  await expectNoHorizontalOverflow(page);
  await oeffnen(page, 'Mittwoch', 'liste');
  const mittwochListe = page.getByRole('list', { name: 'Mittwoch: Teigware' });
  await expect(mittwochListe).toContainText('500 g Nudeln (Spaghetti)');

  // Moved to Wednesday: all 2 kg there
  await oeffnen(page, 'Montag', 'liste');
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti) in Montag anpassen' }).click();
  await montag.getByLabel('Einkauf für Nudeln (Spaghetti)').selectOption({ label: 'Mittwoch' });
  await montag.getByRole('button', { name: 'Verschieben' }).click();
  await expect(page.getByRole('list', { name: 'Nicht in Montag' })).toContainText(
    'Nudeln (Spaghetti)'
  );
  await oeffnen(page, 'Mittwoch', 'liste');
  await expect(mittwochListe).toContainText('2 kg Nudeln (Spaghetti) · hierher verschoben');

  // Back to Monday
  await oeffnen(page, 'Montag', 'liste');
  await page.getByRole('button', { name: 'Nudeln (Spaghetti) zurück in Montag' }).click();
  await expect(page.getByRole('list', { name: 'Montag: Teigware' })).toContainText(
    '1 kg Nudeln (Spaghetti)'
  );
});

test('ticking off what someone else just ticked off keeps the input until saved again', async ({
  page,
  browser,
}) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Konflikt');
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = await oeffnen(page, 'Montag');
  const menge = montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)');
  await menge.fill('1,8');

  // Meanwhile someone else ticks it off
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Einkauf' }).click();
  const dort = await oeffnen(anderes, 'Montag');
  await box(dort, 'Nudeln (Spaghetti)').click();
  await expect(dort.getByRole('status')).toHaveText('1 von 1 abgehakt');

  // The first save is a conflict that names it; the input stays and is saved on request
  await montag.getByRole('button', { name: 'Abhaken' }).click();
  await expect(montag.getByText(/hat das inzwischen abgehakt: 2 kg/)).toBeVisible();
  await expect(menge).toHaveValue('1,8');
  await montag.getByRole('button', { name: 'Trotzdem speichern' }).click();
  await expect(montag).toContainText('1,8 kg');
  await expect(dort).toContainText('1,8 kg', { timeout: 15_000 });

  // Taken back by the other one meanwhile: saving again ticks it off again
  await menge.fill('1,5');
  await box(dort, 'Nudeln (Spaghetti)').click();
  await expect(dort.getByRole('status')).toHaveText('0 von 1 abgehakt');
  await montag.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(montag.getByText(/inzwischen aufgehoben/)).toBeVisible();
  await expect(menge).toHaveValue('1,5');
  await montag.getByRole('button', { name: 'Trotzdem speichern' }).click();
  await expect(montag.getByRole('status')).toHaveText('1 von 1 abgehakt');
  await expect(montag).toContainText('1,5 kg');
  await anderes.context().close();
});

test('a trip being added keeps its draft through maintenance', async ({ page }) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Wartung');
  await page.getByRole('button', { name: 'Einkauf anlegen' }).click();
  const form = page.getByRole('form', { name: 'Neuer Einkauf' });
  const name = form.getByLabel('Name des Einkaufs');
  await name.fill('Metro Freitag');
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
  await wartung(true);
  await expect(name).toBeDisabled({ timeout: 15_000 });
  await expect(name).toHaveValue('Metro Freitag');
  await expect(form.getByRole('button', { name: 'Einkauf anlegen' })).toBeDisabled();
  await wartung(false);
  await expect(name).toBeEnabled({ timeout: 15_000 });
  await page.unroute('**/api/essensplanung/planung/stand?*');
  await form.getByRole('button', { name: 'Einkauf anlegen' }).click();
  await expect(page.getByText('Metro Freitag angelegt.').first()).toBeVisible();
});

test('a thing without an amount keeps what is typed when someone else ticks it off', async ({
  page,
  browser,
}) => {
  test.slow();
  await anlegen(page, 'E2E Einkäufe ohne Menge');
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  const feld = page.getByLabel('Noch etwas besorgen');
  await feld.fill('Kochhandschuhe');
  await feld.press('Enter');
  await expect(page.getByText('Kochhandschuhe steht auf der Einkaufsliste.').first()).toBeVisible();
  await einkaufAnlegen(page, 'Baumarkt', 0);
  const hier = await oeffnen(page, 'Baumarkt');
  const ersatz = hier.getByLabel('Ersatz für Kochhandschuhe');
  await ersatz.fill('Grillhandschuhe');

  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Einkauf' }).click();
  const dort = await oeffnen(anderes, 'Baumarkt');
  await box(dort, 'Kochhandschuhe').click();
  await expect(dort.getByRole('status')).toHaveText('1 von 1 abgehakt');

  // The tick of the other one arrives; what is typed stays
  await expect(hier.getByRole('status')).toHaveText('1 von 1 abgehakt', { timeout: 15_000 });
  await expect(ersatz).toHaveValue('Grillhandschuhe');
  // The button still says what it did when typing started; saving shows the conflict
  await hier.getByRole('button', { name: 'Abhaken' }).click();
  await expect(hier.getByText(/hat das inzwischen abgehakt/)).toBeVisible();
  await hier.getByRole('button', { name: 'Trotzdem speichern' }).click();
  await expect(hier).toContainText('→ Grillhandschuhe');
  await anderes.context().close();
});

test('a change of a trip keeps its draft while the list is looked at', async ({ page }) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Entwurf');
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = await oeffnen(page, 'Montag');
  await montag.getByRole('button', { name: 'Montag ändern' }).click();
  const form = page.getByRole('form', { name: 'Montag ändern' });
  await form.getByLabel('Name des Einkaufs').fill('Montag früh');
  await form.getByLabel('Datum').fill('2027-08-02');
  await montag.getByRole('button', { name: 'Montag ändern' }).click();
  await expect(form).toBeHidden();
  // Also back in the overview and open again
  await oeffnen(page, 'Montag', 'liste');
  await expect(page.getByRole('list', { name: 'Montag: Teigware' })).toBeVisible();
  await montag.getByRole('button', { name: 'Montag ändern' }).click();
  await expect(form.getByLabel('Name des Einkaufs')).toHaveValue('Montag früh');
  await expect(form.getByLabel('Datum')).toHaveValue('2027-08-02');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Montag früh gespeichert.').first()).toBeVisible();
});

test('a thing that falls off the list while being ticked off names what was typed', async ({
  page,
  browser,
}) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe verloren');
  await einkaufAnlegen(page, 'Montag', 0);
  await einkaufAnlegen(page, 'Mittwoch', 0);
  // Wednesday buys nothing yet: everything is on Monday. Monday is ticked off with less, so the
  // rest is on Wednesday
  const montag = await oeffnen(page, 'Montag');
  await montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)').fill('1');
  await montag.getByRole('button', { name: 'Abhaken' }).click();
  await expect(montag.getByRole('status')).toHaveText('1 von 1 abgehakt');
  const mittwoch = await oeffnen(page, 'Mittwoch');
  await mittwoch.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)').fill('800');
  await mittwoch.getByLabel('Einheit von Nudeln (Spaghetti)').selectOption('g');
  await mittwoch.getByLabel('Ersatz für Nudeln (Spaghetti)').fill('Vollkornnudeln');

  // Someone else changes Monday to all of it: Wednesday needs nothing more
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Einkauf' }).click();
  const dort = await oeffnen(anderes, 'Montag');
  await dort.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)').fill('2');
  await dort.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(anderes.getByText('Nudeln (Spaghetti) abgehakt.').first()).toBeVisible();
  await expect(dort).toContainText(/2 kg Nudeln \(Spaghetti\)\s*2 kg/);
  await anderes.context().close();

  await expect(
    page
      .getByText(
        'Nudeln (Spaghetti) steht in diesem Einkauf nicht mehr auf der Liste, jemand hat es anderswo abgehakt (deine Eingabe: 800 g → Vollkornnudeln).'
      )
      .first()
  ).toBeVisible({ timeout: 15_000 });
});

test('what is typed for a thing stays while another one is ticked off, refused amounts are named', async ({
  page,
}) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Entwürfe');
  const feld = page.getByLabel('Noch etwas besorgen');
  await feld.fill('Kochhandschuhe');
  await feld.press('Enter');
  await expect(page.getByText('Kochhandschuhe steht auf der Einkaufsliste.').first()).toBeVisible();
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = await oeffnen(page, 'Montag');
  const menge = montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)');
  await menge.fill('800');
  await montag.getByLabel('Einheit von Nudeln (Spaghetti)').selectOption('g');
  await montag.getByLabel('Ersatz für Nudeln (Spaghetti)').fill('Vollkornnudeln');
  // Ticking off another thing keeps it
  await box(montag, 'Kochhandschuhe').click();
  await expect(montag.getByRole('status')).toHaveText('1 von 2 abgehakt');
  await expect(menge).toHaveValue('800');
  await expect(montag.getByLabel('Ersatz für Nudeln (Spaghetti)')).toHaveValue('Vollkornnudeln');

  // Too much: the row says so and keeps the input
  await menge.fill('1000001');
  await montag.getByLabel('Einheit von Nudeln (Spaghetti)').selectOption('kg');
  await montag.getByRole('button', { name: 'Abhaken' }).click();
  await expect(
    montag.getByRole('alert').filter({ hasText: 'Die Menge ist zu groß.' })
  ).toBeVisible();
  await expect(menge).toHaveValue('1000001');
  await montag.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(menge).toHaveValue('2');

  // A fixed amount too large is named in the row too
  await montag.getByRole('button', { name: 'Liste anpassen' }).click();
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti) in Montag anpassen' }).click();
  const fest = montag.getByLabel('Feste Menge von Nudeln (Spaghetti)');
  await fest.fill('1000001');
  await montag.getByLabel('Einheit der festen Menge von Nudeln (Spaghetti)').selectOption('kg');
  await montag.getByRole('button', { name: 'Feste Menge' }).click();
  await expect(
    montag.getByRole('alert').filter({ hasText: 'Die Menge ist zu groß.' })
  ).toBeVisible();
  await expect(fest).toHaveValue('1000001');
});

test('on a phone the amount opens with a visible button, the box ticks off at once', async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  await nudelnPlanen(page, 'E2E Einkäufe Handy');
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = await oeffnen(page, 'Montag');
  const menge = montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)');
  await expect(menge).toBeHidden();
  const auf = montag.getByRole('button', { name: 'Nudeln (Spaghetti): Menge und Ersatz' });
  await expect(auf).toHaveAttribute('aria-expanded', 'false');
  await auf.click();
  await expect(menge).toBeVisible();
  await menge.fill('1,5');
  await montag.getByRole('button', { name: 'Abhaken' }).click();
  await expect(montag.getByRole('status')).toHaveText('1 von 1 abgehakt');
  await expect(menge).toBeHidden();
  await expect(montag).toContainText('1,5 kg');
  await expectNoHorizontalOverflow(page);
  // Space on the box takes the tick back
  await box(montag, 'Nudeln (Spaghetti)').focus();
  await page.keyboard.press('Space');
  await expect(montag.getByRole('status')).toHaveText('0 von 1 abgehakt');
});

test('leaving the page with something typed in the live mode asks first', async ({ page }) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Verlassen');
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = await oeffnen(page, 'Montag');
  const menge = montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)');
  await menge.fill('800');
  await montag.getByLabel('Ersatz für Nudeln (Spaghetti)').fill('Vollkornnudeln');
  await page.getByRole('link', { name: 'Impressum' }).click();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Weiter bearbeiten');
  await expect(page).toHaveURL(/\/essensplanung\/planung/);
  await expect(menge).toHaveValue('800');
  await expect(montag.getByLabel('Ersatz für Nudeln (Spaghetti)')).toHaveValue('Vollkornnudeln');
});

test('what is typed in the live mode stays while the trip shows its list or is left', async ({
  page,
}) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Ansicht');
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = await oeffnen(page, 'Montag');
  const menge = montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)');
  await menge.fill('800');
  await montag.getByLabel('Einheit von Nudeln (Spaghetti)').selectOption('g');
  await montag.getByLabel('Ersatz für Nudeln (Spaghetti)').fill('Vollkornnudeln');
  const pruefen = async (): Promise<void> => {
    await expect(menge).toHaveValue('800');
    await expect(montag.getByLabel('Einheit von Nudeln (Spaghetti)')).toHaveValue('g');
    await expect(montag.getByLabel('Ersatz für Nudeln (Spaghetti)')).toHaveValue('Vollkornnudeln');
  };
  await montag.getByRole('button', { name: 'Liste anpassen' }).click();
  await expect(menge).toBeHidden();
  await montag.getByRole('button', { name: 'Einkaufen', exact: true }).click();
  await pruefen();
  // Back to the overview with the browser and in again
  await page.goBack();
  await expect(page.getByRole('list', { name: 'Einkäufe' })).toBeVisible();
  await oeffnen(page, 'Montag');
  await pruefen();
  // Another area too, and the kept input is saved like typed
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  await pruefen();
  await montag.getByRole('button', { name: 'Abhaken' }).click();
  await expect(montag).toContainText('800 g → Vollkornnudeln');
});

test('leaving the planning after discarding live input asks no more on other pages', async ({
  page,
}) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Verwerfen');
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = await oeffnen(page, 'Montag');
  await montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)').fill('800');
  await page.getByRole('link', { name: 'Impressum' }).click();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Änderungen verwerfen');
  await expect(page).toHaveURL(/\/impressum/);
  // Back to the planning and away again without the browser loading anew: no question
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'E2E Einkäufe Verwerfen' })).toBeVisible();
  await page.getByRole('link', { name: 'Impressum' }).click();
  await expect(page).toHaveURL(/\/impressum/);
  await expect(page.getByRole('dialog', { name: 'Änderungen verwerfen?' })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'E2E Einkäufe Verwerfen' })).toBeVisible();
  await page.getByRole('link', { name: 'Impressum' }).click();
  await expect(page).toHaveURL(/\/impressum/);
  await expect(page.getByRole('dialog', { name: 'Änderungen verwerfen?' })).toHaveCount(0);
});

test('what is typed while ticking off is saved stays as a new change', async ({ page }) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Weitertippen');
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = await oeffnen(page, 'Montag');
  const menge = montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)');
  const ersatz = montag.getByLabel('Ersatz für Nudeln (Spaghetti)');
  await menge.fill('800');
  await montag.getByLabel('Einheit von Nudeln (Spaghetti)').selectOption('g');
  // The answer takes a moment; meanwhile something else is typed
  let freigeben: () => void = () => undefined;
  const warten = new Promise<void>((done) => (freigeben = done));
  await page.route('**/api/essensplanung/planung/einkaeufe/*/posten', async (route) => {
    await warten;
    await route.continue();
  });
  await montag.getByRole('button', { name: 'Abhaken' }).click();
  await menge.fill('900');
  await ersatz.fill('Vollkornnudeln');
  freigeben();
  await expect(montag.getByRole('status')).toHaveText('1 von 1 abgehakt');
  await expect(menge).toHaveValue('900');
  await expect(ersatz).toHaveValue('Vollkornnudeln');
  await page.unroute('**/api/essensplanung/planung/einkaeufe/*/posten');
  await montag.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(montag.getByRole('button', { name: 'Speichern', exact: true })).toHaveCount(0);
  await expect(montag).toContainText('900 g → Vollkornnudeln');
});

test('a fixed amount typed and not saved stays while another thing is adjusted', async ({
  page,
}) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe feste Menge');
  const feld = page.getByLabel('Noch etwas besorgen');
  await feld.fill('Kochhandschuhe');
  await feld.press('Enter');
  await expect(page.getByText('Kochhandschuhe steht auf der Einkaufsliste.').first()).toBeVisible();
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = await oeffnen(page, 'Montag', 'liste');
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti) in Montag anpassen' }).click();
  const fest = montag.getByLabel('Feste Menge von Nudeln (Spaghetti)');
  await expect(fest).toHaveValue('2');
  await fest.fill('1500');
  await montag.getByLabel('Einheit der festen Menge von Nudeln (Spaghetti)').selectOption('g');
  await montag.getByRole('button', { name: 'Kochhandschuhe in Montag anpassen' }).click();
  await expect(fest).toBeHidden();
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti) in Montag anpassen' }).click();
  await expect(fest).toHaveValue('1500');
  await expect(montag.getByLabel('Einheit der festen Menge von Nudeln (Spaghetti)')).toHaveValue(
    'g'
  );
  await montag.getByRole('button', { name: 'Feste Menge' }).click();
  await expect(page.getByRole('list', { name: 'Montag: Teigware' })).toContainText(
    '1,5 kg Nudeln (Spaghetti) · feste Menge'
  );
});

test('deleting a trip after someone ticked something off meanwhile is a conflict', async ({
  page,
  browser,
}) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Löschen');
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = await oeffnen(page, 'Montag', 'liste');
  await expect(montag.getByRole('status')).toHaveText('0 von 1 abgehakt');
  await montag.getByRole('button', { name: 'Montag löschen' }).click();
  const frage = page.getByRole('dialog', { name: 'Montag löschen?' });
  await expect(frage).toBeVisible();

  // While the question is open, someone else ticks off on Monday
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Einkauf' }).click();
  const dort = await oeffnen(anderes, 'Montag');
  await box(dort, 'Nudeln (Spaghetti)').click();
  await expect(dort.getByRole('status')).toHaveText('1 von 1 abgehakt');
  await anderes.context().close();
  await expect(montag.getByRole('status')).toHaveText('1 von 1 abgehakt', { timeout: 15_000 });

  // Deleting with what was seen when asking: a conflict, the trip stays
  await answerConfirm(page, 'Montag löschen?', 'Löschen');
  await expect(page.getByText(/Jemand anderes hat das gerade geändert/).first()).toBeVisible();
  await expect(montag.getByRole('status')).toHaveText('1 von 1 abgehakt');
});

test('while a fixed amount is saved its row waits, each amount stays with its thing', async ({
  page,
}) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe feste Menge sperren');
  const feld = page.getByLabel('Noch etwas besorgen');
  await feld.fill('Kochhandschuhe');
  await feld.press('Enter');
  await expect(page.getByText('Kochhandschuhe steht auf der Einkaufsliste.').first()).toBeVisible();
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = await oeffnen(page, 'Montag', 'liste');
  const nudelnAnpassen = montag.getByRole('button', {
    name: 'Nudeln (Spaghetti) in Montag anpassen',
  });
  const handschuheAnpassen = montag.getByRole('button', {
    name: 'Kochhandschuhe in Montag anpassen',
  });
  await nudelnAnpassen.click();
  const fest = montag.getByLabel('Feste Menge von Nudeln (Spaghetti)');
  await fest.fill('1500');
  await montag.getByLabel('Einheit der festen Menge von Nudeln (Spaghetti)').selectOption('g');
  let freigeben: () => void = () => undefined;
  const warten = new Promise<void>((done) => (freigeben = done));
  await page.route('**/api/essensplanung/planung/einkaeufe/*/regeln', async (route) => {
    await warten;
    await route.continue();
  });
  await montag.getByRole('button', { name: 'Feste Menge' }).click();
  // While it is saved, neither the amount nor another thing can be changed
  await expect(fest).toBeDisabled();
  await expect(handschuheAnpassen).toBeDisabled();
  freigeben();
  const liste = page.getByRole('list', { name: 'Montag: Teigware' });
  await expect(liste).toContainText('1,5 kg Nudeln (Spaghetti) · feste Menge');
  await page.unroute('**/api/essensplanung/planung/einkaeufe/*/regeln');
  // Gloves get 2 typed, not saved; Pasta keeps its saved amount
  await handschuheAnpassen.click();
  const handschuhe = montag.getByLabel('Feste Menge von Kochhandschuhe');
  await handschuhe.fill('2');
  await nudelnAnpassen.click();
  await expect(fest).toHaveValue('1500');
  await expect(montag.getByLabel('Einheit der festen Menge von Nudeln (Spaghetti)')).toHaveValue(
    'g'
  );
  await handschuheAnpassen.click();
  await expect(handschuhe).toHaveValue('2');
});

test('a trip being changed cannot be typed into while it is saved', async ({ page }) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Formular sperren');
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = await oeffnen(page, 'Montag');
  await montag.getByRole('button', { name: 'Montag ändern' }).click();
  const form = page.getByRole('form', { name: 'Montag ändern' });
  const name = form.getByLabel('Name des Einkaufs');
  await name.fill('Montag früh');
  let freigeben: () => void = () => undefined;
  const warten = new Promise<void>((done) => (freigeben = done));
  await page.route('**/api/essensplanung/planung/einkaeufe/*', async (route) => {
    if (route.request().method() === 'PATCH') await warten;
    await route.continue();
  });
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(name).toBeDisabled();
  await expect(form.getByLabel('Datum')).toBeDisabled();
  freigeben();
  await expect(page.getByText('Montag früh gespeichert.').first()).toBeVisible();
  await page.unroute('**/api/essensplanung/planung/einkaeufe/*');
});

test('a trip being added cannot be cancelled while it is saved', async ({ page }) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Abbrechen');
  await page.getByRole('button', { name: 'Einkauf anlegen' }).click();
  const form = page.getByRole('form', { name: 'Neuer Einkauf' });
  await form.getByLabel('Name des Einkaufs').fill('Montag');
  let freigeben: () => void = () => undefined;
  const warten = new Promise<void>((done) => (freigeben = done));
  await page.route('**/api/essensplanung/planung/einkaeufe', async (route) => {
    await warten;
    await route.continue();
  });
  await form.getByRole('button', { name: 'Einkauf anlegen' }).click();
  await expect(form.getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
  freigeben();
  await expect(page.getByText('Montag angelegt.').first()).toBeVisible();
  await page.unroute('**/api/essensplanung/planung/einkaeufe');
  // A new form opens and stays open
  await page.getByRole('button', { name: 'Einkauf anlegen' }).click();
  await expect(page.getByRole('form', { name: 'Neuer Einkauf' })).toBeVisible();
});

test('changes of a trip someone else deletes are named to copy', async ({ page, browser }) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe gelöscht');
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = await oeffnen(page, 'Montag');
  await montag.getByRole('button', { name: 'Montag ändern' }).click();
  const form = page.getByRole('form', { name: 'Montag ändern' });
  await form.getByLabel('Name des Einkaufs').fill('Montag früh');

  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Einkauf' }).click();
  const dort = await oeffnen(anderes, 'Montag');
  await dort.getByRole('button', { name: 'Montag löschen' }).click();
  await answerConfirm(anderes, 'Montag löschen?', 'Löschen');
  await expect(anderes.getByText('Montag gelöscht.').first()).toBeVisible();
  await anderes.context().close();

  await expect(
    page
      .getByText(
        'Den Einkauf „Montag“ hat jemand gelöscht (deine Eingabe: Montag früh, alle Geschäfte, alle Mahlzeiten).'
      )
      .first()
  ).toBeVisible({ timeout: 15_000 });
  // The page shows the overview again
  await expect(page.getByText('Noch keine Einkäufe.')).toBeVisible();
});

test('a tick saved after leaving the live mode leaves no draft behind', async ({ page }) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe später fertig');
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = await oeffnen(page, 'Montag');
  const menge = montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)');
  await menge.fill('800');
  await montag.getByLabel('Einheit von Nudeln (Spaghetti)').selectOption('g');
  let freigeben: () => void = () => undefined;
  const warten = new Promise<void>((done) => (freigeben = done));
  await page.route('**/api/essensplanung/planung/einkaeufe/*/posten', async (route) => {
    await warten;
    await route.continue();
  });
  await montag.getByRole('button', { name: 'Abhaken' }).click();
  await montag.getByRole('button', { name: 'Liste anpassen' }).click();
  freigeben();
  await expect(montag.getByRole('status')).toHaveText('1 von 1 abgehakt');
  await page.unroute('**/api/essensplanung/planung/einkaeufe/*/posten');
  await montag.getByRole('button', { name: 'Einkaufen', exact: true }).click();
  await expect(menge).toHaveValue('800');
  await expect(montag.getByRole('button', { name: 'Speichern', exact: true })).toHaveCount(0);
  // Nothing unsaved: leaving asks nothing
  await page.getByRole('link', { name: 'Impressum' }).click();
  await expect(page).toHaveURL(/\/impressum/);
  await expect(page.getByRole('dialog', { name: 'Änderungen verwerfen?' })).toHaveCount(0);
});
