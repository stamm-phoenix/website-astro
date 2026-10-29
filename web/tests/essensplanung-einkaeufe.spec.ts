import type { Page } from '@playwright/test';
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

const karte = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Einkäufe' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name }) });

test('two shop at once in the live mode; a rest goes to the next trip and into the stock', async ({
  page,
  browser,
}) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe');
  await einkaufAnlegen(page, 'Montag', 2);
  await einkaufAnlegen(page, 'Mittwoch', 0);
  const montag = karte(page, 'Montag');
  const mittwoch = karte(page, 'Mittwoch');
  await expect(montag).toContainText('bis 1_2 Mittagessen');
  await expect(montag).toContainText('1 Posten · 0 von 1 abgehakt');

  await montag.getByRole('button', { name: 'Liste von Montag' }).click();
  await expect(page.getByRole('list', { name: 'Montag: Teigware' })).toContainText(
    '1 kg Nudeln (Spaghetti)'
  );
  await mittwoch.getByRole('button', { name: 'Liste von Mittwoch' }).click();
  await expect(page.getByRole('list', { name: 'Mittwoch: Teigware' })).toContainText(
    '1 kg Nudeln (Spaghetti)'
  );
  await expectNoHorizontalOverflow(page);

  // Someone else opens the same trip in the live mode
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Einkauf' }).click();
  await karte(anderes, 'Montag').getByRole('button', { name: 'Montag: Einkaufen' }).click();
  await expect(karte(anderes, 'Montag').getByRole('status')).toHaveText('0 von 1 abgehakt');

  // Only 800 g, and wholegrain instead
  await montag.getByRole('button', { name: 'Montag: Einkaufen' }).click();
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti)', exact: true }).click();
  const menge = montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)');
  await expect(menge).toHaveValue('1');
  await menge.fill('0,8');
  await montag.getByLabel('Ersatz für Nudeln (Spaghetti)').fill('Vollkornnudeln');
  await montag.getByRole('button', { name: 'Abhaken' }).click();
  await expect(montag.getByRole('status')).toHaveText('1 von 1 abgehakt');
  await expect(montag).toContainText('800 g → Vollkornnudeln');
  await expectNoHorizontalOverflow(page);

  // The other one sees it without reloading
  await expect(karte(anderes, 'Montag').getByRole('status')).toHaveText('1 von 1 abgehakt', {
    timeout: 15_000,
  });
  await expect(karte(anderes, 'Montag')).toContainText('von Kim Küche');

  // The missing 200 g are bought on Wednesday; the stock has what was bought
  await expect(page.getByRole('list', { name: 'Mittwoch: Teigware' })).toContainText(
    '1,2 kg Nudeln (Spaghetti)'
  );
  const lager = page.getByRole('table');
  await expect(lager.getByRole('row', { name: /Nudeln \(Spaghetti\)/ })).toContainText(
    /→ Vollkornnudeln\s*0 g\s*800 g\s*0 g\s*800 g/
  );
  // The open shopping list is what is needed less the stock now
  await expect(page.getByRole('list', { name: 'Ohne Geschäft: Teigware' })).toContainText(
    '1,2 kg Nudeln (Spaghetti)'
  );
  // The dish names the replacement
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByLabel('Mengen für 8 Portionen von Nudeln').first().click();
  await expect(page.getByRole('list', { name: 'Mengen für Nudeln bei 1_2' })).toContainText(
    'Nudeln (Spaghetti) → Vollkornnudeln'
  );
  await page.getByRole('tab', { name: 'Einkauf' }).click();

  // The other one ticks off Wednesday, then takes it back again
  await karte(anderes, 'Mittwoch').getByRole('button', { name: 'Mittwoch: Einkaufen' }).click();
  await karte(anderes, 'Mittwoch')
    .getByRole('button', { name: 'Nudeln (Spaghetti)', exact: true })
    .click();
  await karte(anderes, 'Mittwoch').getByRole('button', { name: 'Abhaken' }).click();
  await expect(karte(anderes, 'Mittwoch').getByRole('status')).toHaveText('1 von 1 abgehakt');
  await expect(mittwoch).toContainText('1 von 1 abgehakt', { timeout: 15_000 });
  await karte(anderes, 'Mittwoch')
    .getByRole('button', { name: 'Nudeln (Spaghetti) (abgehakt)' })
    .click();
  await karte(anderes, 'Mittwoch').getByRole('button', { name: 'Häkchen aufheben' }).click();
  await expect(karte(anderes, 'Mittwoch').getByRole('status')).toHaveText('0 von 1 abgehakt');
  await anderes.context().close();

  // The trip as a PDF with a box per thing
  const pdf = await pdfLaden(page, () =>
    mittwoch.getByRole('button', { name: 'Mittwoch als PDF' }).click()
  );
  expect(pdf.name).toContain('Mittwoch');
  expect(pdf.text).toContain('Nudeln (Spaghetti)');
  expect(pdf.text).toContain('1,2 kg');

  // Finishing Monday keeps what was bought
  await montag.getByRole('button', { name: 'Montag abschließen' }).click();
  await expect(montag).toContainText('abgeschlossen');
  await expect(page.getByRole('list', { name: 'Mittwoch: Teigware' })).toContainText(
    '1,2 kg Nudeln (Spaghetti)'
  );

  // Deleting it asks first; what was bought leaves the stock
  await montag.getByRole('button', { name: 'Montag löschen' }).click();
  await answerConfirm(page, 'Montag löschen?', 'Löschen');
  await expect(page.getByText('Montag gelöscht.').first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Mittwoch: Teigware' })).toContainText(
    '2 kg Nudeln (Spaghetti)'
  );
});

test('things move to another trip or get a fixed amount by hand', async ({ page }) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Regeln');
  await einkaufAnlegen(page, 'Montag', 2);
  await einkaufAnlegen(page, 'Mittwoch', 0);
  const montag = karte(page, 'Montag');
  await montag.getByRole('button', { name: 'Liste von Montag' }).click();
  await karte(page, 'Mittwoch').getByRole('button', { name: 'Liste von Mittwoch' }).click();
  const mittwochListe = page.getByRole('list', { name: 'Mittwoch: Teigware' });

  // A fixed amount: 1,5 kg on Monday, so 500 g are left for Wednesday
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti) in Montag anpassen' }).click();
  await montag.getByLabel('Feste Menge von Nudeln (Spaghetti)').fill('1,5');
  await montag.getByLabel('Einheit der festen Menge von Nudeln (Spaghetti)').selectOption('kg');
  await montag.getByRole('button', { name: 'Feste Menge' }).click();
  await expect(page.getByRole('list', { name: 'Montag: Teigware' })).toContainText(
    '1,5 kg Nudeln (Spaghetti) · feste Menge'
  );
  await expect(mittwochListe).toContainText('500 g Nudeln (Spaghetti)');
  await expectNoHorizontalOverflow(page);

  // Moved to Wednesday: all 2 kg there
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti) in Montag anpassen' }).click();
  await montag.getByLabel('Einkauf für Nudeln (Spaghetti)').selectOption({ label: 'Mittwoch' });
  await montag.getByRole('button', { name: 'Verschieben' }).click();
  await expect(mittwochListe).toContainText('2 kg Nudeln (Spaghetti) · hierher verschoben');
  await expect(page.getByRole('list', { name: 'Nicht in Montag' })).toContainText(
    'Nudeln (Spaghetti)'
  );

  // Back to Monday
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
  const montag = karte(page, 'Montag');
  await montag.getByRole('button', { name: 'Montag: Einkaufen' }).click();
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti)', exact: true }).click();
  const menge = montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)');
  await menge.fill('1,8');

  // Meanwhile someone else ticks it off
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Einkauf' }).click();
  const dort = karte(anderes, 'Montag');
  await dort.getByRole('button', { name: 'Montag: Einkaufen' }).click();
  await dort.getByRole('button', { name: 'Nudeln (Spaghetti)', exact: true }).click();
  await dort.getByRole('button', { name: 'Abhaken' }).click();
  await expect(dort.getByRole('status')).toHaveText('1 von 1 abgehakt');

  // The first save is a conflict that names it; the input stays and is saved on request
  await montag.getByRole('button', { name: 'Abhaken' }).click();
  await expect(montag.getByText(/hat das inzwischen abgehakt: 2 kg/)).toBeVisible();
  await expect(menge).toHaveValue('1,8');
  await montag.getByRole('button', { name: 'Trotzdem speichern' }).click();
  await expect(montag).toContainText('1,8 kg');
  await expect(dort).toContainText('1,8 kg', { timeout: 15_000 });

  // Taken back by the other one meanwhile: saving again ticks it off again
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti) (abgehakt)' }).click();
  await menge.fill('1,5');
  await dort.getByRole('button', { name: 'Nudeln (Spaghetti) (abgehakt)' }).click();
  await dort.getByRole('button', { name: 'Häkchen aufheben' }).click();
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
  const hier = karte(page, 'Baumarkt');
  await hier.getByRole('button', { name: 'Baumarkt: Einkaufen' }).click();
  await hier.getByRole('button', { name: 'Kochhandschuhe', exact: true }).click();
  const ersatz = hier.getByLabel('Ersatz für Kochhandschuhe');
  await ersatz.fill('Grillhandschuhe');

  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Einkauf' }).click();
  const dort = karte(anderes, 'Baumarkt');
  await dort.getByRole('button', { name: 'Baumarkt: Einkaufen' }).click();
  await dort.getByRole('button', { name: 'Kochhandschuhe', exact: true }).click();
  await dort.getByRole('button', { name: 'Abhaken' }).click();
  await expect(dort.getByRole('status')).toHaveText('1 von 1 abgehakt');

  // The tick of the other one arrives; the open row and what is typed stay
  await expect(hier.getByRole('status')).toHaveText('1 von 1 abgehakt', { timeout: 15_000 });
  await expect(ersatz).toHaveValue('Grillhandschuhe');
  // The button still says what it did when opened; saving shows the conflict
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
  const montag = karte(page, 'Montag');
  await montag.getByRole('button', { name: 'Montag ändern' }).click();
  const form = page.getByRole('form', { name: 'Montag ändern' });
  await form.getByLabel('Name des Einkaufs').fill('Montag früh');
  await form.getByLabel('Datum').fill('2027-08-02');
  await montag.getByRole('button', { name: 'Liste von Montag' }).click();
  await expect(page.getByRole('list', { name: 'Montag: Teigware' })).toBeVisible();
  await expect(form).toBeHidden();
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
  const mittwoch = karte(page, 'Mittwoch');
  // Wednesday buys nothing yet: everything is on Monday. Monday is finished with less, so the
  // rest is on Wednesday
  const montag = karte(page, 'Montag');
  await montag.getByRole('button', { name: 'Montag: Einkaufen' }).click();
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti)', exact: true }).click();
  await montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)').fill('1');
  await montag.getByRole('button', { name: 'Abhaken' }).click();
  await expect(montag.getByRole('status')).toHaveText('1 von 1 abgehakt');
  await mittwoch.getByRole('button', { name: 'Mittwoch: Einkaufen' }).click();
  await mittwoch.getByRole('button', { name: 'Nudeln (Spaghetti)', exact: true }).click();
  await mittwoch.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)').fill('800');
  await mittwoch.getByLabel('Einheit von Nudeln (Spaghetti)').selectOption('g');
  await mittwoch.getByLabel('Ersatz für Nudeln (Spaghetti)').fill('Vollkornnudeln');

  // Someone else changes Monday to all of it: Wednesday needs nothing more
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Einkauf' }).click();
  const dort = karte(anderes, 'Montag');
  await dort.getByRole('button', { name: 'Montag: Einkaufen' }).click();
  await dort.getByRole('button', { name: 'Nudeln (Spaghetti) (abgehakt)' }).click();
  await dort.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)').fill('2');
  await dort.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(anderes.getByText('Nudeln (Spaghetti) abgehakt.').first()).toBeVisible();
  await expect(dort.getByRole('button', { name: 'Nudeln (Spaghetti) (abgehakt)' })).toContainText(
    /2 kg Nudeln \(Spaghetti\)\s*2 kg/
  );
  await anderes.context().close();

  await expect(
    page
      .getByText(
        'Nudeln (Spaghetti) steht in diesem Einkauf nicht mehr auf der Liste, jemand hat es anderswo abgehakt (deine Eingabe: 800 g → Vollkornnudeln).'
      )
      .first()
  ).toBeVisible({ timeout: 15_000 });
});

test('what is typed for a thing stays while another one is open, refused amounts are named', async ({
  page,
}) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Entwürfe');
  const feld = page.getByLabel('Noch etwas besorgen');
  await feld.fill('Kochhandschuhe');
  await feld.press('Enter');
  await expect(page.getByText('Kochhandschuhe steht auf der Einkaufsliste.').first()).toBeVisible();
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = karte(page, 'Montag');
  await montag.getByRole('button', { name: 'Montag: Einkaufen' }).click();
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti)', exact: true }).click();
  const menge = montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)');
  await menge.fill('800');
  await montag.getByLabel('Einheit von Nudeln (Spaghetti)').selectOption('g');
  await montag.getByLabel('Ersatz für Nudeln (Spaghetti)').fill('Vollkornnudeln');
  await montag.getByRole('button', { name: 'Kochhandschuhe', exact: true }).click();
  await expect(menge).toBeHidden();
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti)', exact: true }).click();
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

  // A fixed amount too large is named in the row too
  await montag.getByRole('button', { name: 'Montag: Einkaufen beenden' }).click();
  await montag.getByRole('button', { name: 'Liste von Montag' }).click();
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

test('leaving the page with something typed in the live mode asks first', async ({ page }) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Verlassen');
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = karte(page, 'Montag');
  await montag.getByRole('button', { name: 'Montag: Einkaufen' }).click();
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti)', exact: true }).click();
  const menge = montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)');
  await menge.fill('800');
  await montag.getByLabel('Ersatz für Nudeln (Spaghetti)').fill('Vollkornnudeln');
  await page.getByRole('link', { name: 'Impressum' }).click();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Weiter bearbeiten');
  await expect(page).toHaveURL(/\/essensplanung\/planung/);
  await expect(menge).toHaveValue('800');
  await expect(montag.getByLabel('Ersatz für Nudeln (Spaghetti)')).toHaveValue('Vollkornnudeln');
});

test('what is typed in the live mode stays while the trip shows its list', async ({ page }) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Ansicht');
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = karte(page, 'Montag');
  await montag.getByRole('button', { name: 'Montag: Einkaufen' }).click();
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti)', exact: true }).click();
  const menge = montag.getByLabel('Erhaltene Menge von Nudeln (Spaghetti)');
  await menge.fill('800');
  await montag.getByLabel('Einheit von Nudeln (Spaghetti)').selectOption('g');
  await montag.getByLabel('Ersatz für Nudeln (Spaghetti)').fill('Vollkornnudeln');
  for (const ansicht of ['Liste von Montag', 'Montag ändern']) {
    await montag.getByRole('button', { name: ansicht }).click();
    await expect(menge).toBeHidden();
    await montag.getByRole('button', { name: 'Montag: Einkaufen' }).click();
    await expect(menge).toHaveValue('800');
    await expect(montag.getByLabel('Einheit von Nudeln (Spaghetti)')).toHaveValue('g');
    await expect(montag.getByLabel('Ersatz für Nudeln (Spaghetti)')).toHaveValue('Vollkornnudeln');
  }
  // „Fertig“ too, and the kept input is saved like typed
  await montag.getByRole('button', { name: 'Montag: Einkaufen beenden' }).click();
  await montag.getByRole('button', { name: 'Montag: Einkaufen' }).click();
  await expect(menge).toHaveValue('800');
  await montag.getByRole('button', { name: 'Abhaken' }).click();
  await expect(montag).toContainText('800 g → Vollkornnudeln');
});

test('leaving the planning after discarding live input asks no more on other pages', async ({
  page,
}) => {
  test.slow();
  await nudelnPlanen(page, 'E2E Einkäufe Verwerfen');
  await einkaufAnlegen(page, 'Montag', 0);
  const montag = karte(page, 'Montag');
  await montag.getByRole('button', { name: 'Montag: Einkaufen' }).click();
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti)', exact: true }).click();
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
  const montag = karte(page, 'Montag');
  await montag.getByRole('button', { name: 'Montag: Einkaufen' }).click();
  await montag.getByRole('button', { name: 'Nudeln (Spaghetti)', exact: true }).click();
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
  await expect(menge).toBeHidden();
  await expect(montag).toContainText('900 g → Vollkornnudeln');
});
