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
