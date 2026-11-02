import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';
import { anlegen, pdfLaden, aufklappen, liveFeld } from './essensplanung-helpers';
import {
  nudelnPlanen,
  einkaufAnlegen,
  uebersicht,
  oeffnen,
  box,
} from './essensplanung-einkaeufe-helpers';

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
  const menge = await liveFeld(montag, 'Erhaltene Menge von Nudeln (Spaghetti)');
  await expect(menge).toHaveValue('1');
  await menge.fill('0,8');
  const ersatz = await liveFeld(montag, 'Ersatz für Nudeln (Spaghetti)');
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
  await page.getByRole('tab', { name: 'Lager' }).click();
  const lager = page.getByRole('table', { name: 'Lager' });
  await expect(lager.getByRole('row', { name: /Nudeln \(Spaghetti\)/ })).toContainText(
    /→ Vollkornnudeln\s*0 g\s*800 g\s*0 g\s*800 g/
  );
  // The open shopping list is what is needed less the stock now
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  await expect(page.getByRole('rowgroup', { name: 'Ohne Geschäft: Teigware' })).toContainText(
    /1,2 kg\s*Nudeln \(Spaghetti\)/
  );
  // The dish names the replacement
  await page.getByRole('tab', { name: 'Plan' }).click();
  await aufklappen(page, '1_2_1', 'Nudeln');
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
  const menge = await liveFeld(montag, 'Erhaltene Menge von Nudeln (Spaghetti)');
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
  await (await liveFeld(montag, 'Erhaltene Menge von Nudeln (Spaghetti)')).fill('1,5');
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
  const ersatz = await liveFeld(hier, 'Ersatz für Kochhandschuhe');
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
