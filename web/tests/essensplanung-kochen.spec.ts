import type { Page } from '@playwright/test';
import { test, expect, answerConfirm, expectNoHorizontalOverflow } from './fixtures';
import { aufklappen, pdfLaden, verbrauchOeffnen } from './essensplanung-helpers';
import { nudeln, planungVorbereiten } from './essensplanung-vorbereitung';

test('dishes are ticked off as cooked or left out; the stock and the list follow', async ({
  page,
  browser,
}) => {
  test.slow();
  // Pasta for 4: 500 g; 8 people eat it at lunch on both days
  await planungVorbereiten(page, 'E2E Kochen', {
    gerichte: [nudeln(['1_2', '2_2'])],
    teilnehmende: [{ gruppe: 'Pfadi', anzahl: 8 }],
    tab: 'Plan',
  });
  const dialog = page.getByRole('dialog');

  // 1,5 kg in stock: 2 × 1 kg needed, 500 g to buy
  await page.getByRole('tab', { name: 'Lager' }).click();
  await page.getByRole('button', { name: 'Bestand eintragen' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Nudeln (Spag');
  await dialog.getByRole('option', { name: 'Nudeln (Spaghetti)' }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('1,5');
  await dialog.getByLabel('Einheit', { exact: true }).fill('kg');
  await dialog.getByRole('button', { name: 'Eintragen' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  const liste = page.getByRole('rowgroup', { name: 'Ohne Geschäft: Teigware' });
  await expect(liste).toContainText('500 g Nudeln (Spaghetti)');

  // The first lunch is cooked, but only 800 g were used
  await page.getByRole('tab', { name: 'Plan' }).click();
  await verbrauchOeffnen(page, '1_2_1', 'Nudeln');
  const verbrauch = page.getByLabel('Verbrauch von Nudeln (Spaghetti) bei 1_2_1');
  await expect(verbrauch).toHaveValue('1');
  await verbrauch.fill('0,8');
  await page.getByRole('button', { name: 'Gekocht', exact: true }).click();
  await expect(page.getByText('Nudeln ist als gekocht abgehakt.').first()).toBeVisible();
  const mittag = page.getByRole('list', { name: 'Gerichte bei 1_2' });
  await expect(mittag.getByText('gekocht', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // The calendar shows it too and leads to what it used in the list
  await page.getByRole('button', { name: 'Kalender' }).click();
  const kalender = page.locator('[data-kalender="1_2"]');
  await expect(kalender.getByText('gekocht', { exact: true })).toBeVisible();
  await kalender.getByRole('button', { name: 'Mehr zu 1_2_1 Nudeln' }).click();
  await kalender.getByRole('button', { name: 'Mengen und Verbrauch' }).click();
  await verbrauchOeffnen(page, '1_2_1', 'Nudeln');
  await expect(page.getByLabel('Verbrauch von Nudeln (Spaghetti) bei 1_2_1')).toHaveValue('0,8');

  // Through the read link what was used can be looked at, not changed
  await page.getByRole('tab', { name: 'Mitglieder' }).click();
  await page.getByRole('button', { name: 'Link erzeugen', exact: true }).nth(1).click();
  const links = page
    .locator('.copy-code .font-mono')
    .filter({ hasText: '/essensplanung/planung#t=' });
  await expect(links).toHaveCount(2);
  const leser = await (await browser.newContext()).newPage();
  await leser.goto((await links.last().textContent())!.trim());
  await verbrauchOeffnen(leser, '1_2_1', 'Nudeln');
  const gelesen = leser.getByRole('list', { name: 'Verbrauch von Nudeln bei 1_2_1' });
  await expect(gelesen).toContainText(/Nudeln \(Spaghetti\)\s*0,8 kg/);
  await expect(gelesen.getByRole('textbox')).toHaveCount(0);
  await expect(leser.getByRole('button', { name: 'Verbrauch speichern' })).toHaveCount(0);
  await leser.context().close();
  await page.getByRole('tab', { name: 'Plan' }).click();

  // Others see it; the stock has 700 g left, so 300 g of the second lunch are bought
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Einkauf' }).click();
  await expect(anderes.getByRole('rowgroup', { name: 'Ohne Geschäft: Teigware' })).toContainText(
    '300 g Nudeln (Spaghetti)'
  );
  await anderes.getByRole('tab', { name: 'Lager' }).click();
  const lager = anderes.getByRole('table', { name: 'Lager' });
  await expect(lager.getByRole('row', { name: /Nudeln \(Spaghetti\)/ })).toContainText(
    /1,5 kg\s*0 g\s*800 g\s*700 g/
  );
  const pdf = await pdfLaden(anderes, () =>
    anderes.getByRole('button', { name: 'Lager als PDF' }).click()
  );
  expect(pdf.text).toContain('700 g');
  await anderes.context().close();

  // The second lunch is left out: nothing more to buy, the stock stays
  await verbrauchOeffnen(page, '2_2_1', 'Nudeln');
  await page
    .getByRole('list', { name: 'Gerichte bei 2_2' })
    .getByRole('button', { name: 'Ausgelassen', exact: true })
    .click();
  await expect(page.getByText('Nudeln ist als ausgelassen abgehakt.').first()).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Gerichte bei 2_2' }).getByText('ausgelassen', { exact: true })
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  await expect(page.getByText('Noch nichts zu kaufen.')).toBeVisible();

  // Not used at all: the first lunch used nothing, so the stock is full again
  await page.getByRole('tab', { name: 'Plan' }).click();
  await verbrauchOeffnen(page, '1_2_1', 'Nudeln');
  await page.getByLabel('Nudeln (Spaghetti) bei 1_2_1 verwendet').uncheck();
  await page.getByRole('button', { name: 'Verbrauch speichern' }).click();
  await expect(page.getByText('Nudeln ist als gekocht abgehakt.').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Lager' }).click();
  await expect(
    page.getByRole('table', { name: 'Lager' }).getByRole('row', { name: /Nudeln/ })
  ).toContainText(/1,5 kg\s*0 g\s*0 g\s*1,5 kg/);

  // Open again: it is needed again, and the stock covers it
  await page.getByRole('tab', { name: 'Plan' }).click();
  await verbrauchOeffnen(page, '1_2_1', 'Nudeln');
  await mittag.getByRole('button', { name: 'Wieder offen', exact: true }).click();
  await expect(page.getByText('Nudeln ist wieder offen.').first()).toBeVisible();
  await expect(mittag.getByText('gekocht', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  await expect(page.getByText('Noch nichts zu kaufen.')).toBeVisible();
});

test('amounts typed to tick off a dish stay through maintenance', async ({ page }) => {
  await planungVorbereiten(page, 'E2E Kochen Wartung', {
    gerichte: [nudeln(['1_2'])],
    tab: 'Plan',
  });

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
  await verbrauchOeffnen(page, '1_2_1', 'Nudeln');
  const verbrauch = page.getByLabel('Verbrauch von Nudeln (Spaghetti) bei 1_2_1');
  await verbrauch.fill('0,3');
  await wartung(true);
  await expect(page.getByRole('button', { name: 'Gekocht', exact: true })).toBeDisabled({
    timeout: 15_000,
  });
  await expect(verbrauch).toHaveValue('0,3');
  await wartung(false);
  await expect(page.getByRole('button', { name: 'Gekocht', exact: true })).toBeEnabled({
    timeout: 15_000,
  });
  await expect(verbrauch).toHaveValue('0,3');
  await page.unroute('**/api/essensplanung/planung/stand?*');

  // An amount refused by the server names why, and the input stays
  await verbrauch.fill('2000000');
  await page.getByRole('button', { name: 'Gekocht', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Die Menge ist zu groß.' })).toBeVisible();
  await expect(verbrauch).toHaveValue('2000000');
  await verbrauch.fill('0,3');

  // Folding it away and opening it again keeps the amounts; discarding takes the planned ones
  const abhaken = page.getByLabel(/^Verbrauch von Nudeln bei 1_2_1 (eintragen|ändern)$/);
  await abhaken.click();
  await expect(verbrauch).toBeHidden();
  await abhaken.click();
  await expect(verbrauch).toHaveValue('0,3');
  await page.getByRole('button', { name: 'Eingaben verwerfen' }).click();
  await expect(verbrauch).not.toHaveValue('0,3');
  await expect(page.getByRole('button', { name: 'Eingaben verwerfen' })).toBeHidden();
  const geplant = await verbrauch.inputValue();

  // Leaving the page and discarding gives the amounts up; coming back shows what is planned
  await verbrauch.fill('0,3');
  await page.getByRole('link', { name: 'Impressum' }).first().click();
  const frage = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
  await frage.getByRole('button', { name: 'Änderungen verwerfen' }).click();
  await expect(page).toHaveURL(/impressum/);
  // Back within the page's router, which keeps the scripts loaded
  await page.goBack();
  await verbrauchOeffnen(page, '1_2_1', 'Nudeln');
  await expect(verbrauch).toHaveValue(geplant);
});

/** A Planung with the dish Nudeln (4 Personen, 500 g Nudeln) planned for 1_2. */
function nudelnPlanen(page: Page, titel: string): Promise<void> {
  return planungVorbereiten(page, titel, { gerichte: [nudeln(['1_2'])], tab: 'Plan' });
}

test('ticking off after someone else did keeps the amounts and saves them on the second try', async ({
  page,
  browser,
}) => {
  await nudelnPlanen(page, 'E2E Kochen Konflikt');

  await verbrauchOeffnen(page, '1_2_1', 'Nudeln');
  const verbrauch = page.getByLabel('Verbrauch von Nudeln (Spaghetti) bei 1_2_1');
  await verbrauch.fill('0,3');

  // Someone else leaves it out meanwhile
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await verbrauchOeffnen(anderes, '1_2_1', 'Nudeln');
  await anderes.getByRole('button', { name: 'Ausgelassen', exact: true }).click();
  await expect(anderes.getByText('Nudeln ist als ausgelassen abgehakt.').first()).toBeVisible();
  await anderes.context().close();

  await page.getByRole('button', { name: 'Gekocht', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Jetzt gespeichert: ausgelassen.' })
  ).toBeVisible();
  await expect(verbrauch).toHaveValue('0,3');
  await page.getByRole('button', { name: 'Gekocht', exact: true }).click();
  await expect(page.getByText('Nudeln ist als gekocht abgehakt.').first()).toBeVisible();
  await verbrauchOeffnen(page, '1_2_1', 'Nudeln');
  await expect(verbrauch).toHaveValue('0,3');
});

test('typed amounts of a cooked dish move along when someone else moves it and are shown to copy when it is taken off', async ({
  page,
  browser,
}) => {
  await nudelnPlanen(page, 'E2E Kochen Verschieben');

  // The dish is ticked off as cooked with the typed amount, as in the test above
  await verbrauchOeffnen(page, '1_2_1', 'Nudeln');
  const verbrauch = page.getByLabel('Verbrauch von Nudeln (Spaghetti) bei 1_2_1');
  await verbrauch.fill('0,3');
  await page.getByRole('button', { name: 'Gekocht', exact: true }).click();
  await expect(page.getByText('Nudeln ist als gekocht abgehakt.').first()).toBeVisible();
  await verbrauchOeffnen(page, '1_2_1', 'Nudeln');
  await expect(verbrauch).toHaveValue('0,3');

  // Typed amounts move along when someone else moves the dish to another meal
  await verbrauch.fill('0,4');
  const zweites = await (await browser.newContext()).newPage();
  await zweites.goto(page.url());
  await aufklappen(zweites, '1_2_1', 'Nudeln');
  await zweites.getByRole('button', { name: 'Nudeln bei 1_2_1 ändern' }).click();
  await zweites
    .getByRole('dialog')
    .getByLabel('Mahlzeit', { exact: true })
    .selectOption({ label: '1_4 Abendessen' });
  await zweites.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(zweites.getByRole('list', { name: 'Gerichte bei 1_4' })).toContainText('Nudeln');
  const verschoben = page.getByLabel('Verbrauch von Nudeln (Spaghetti) bei 1_4_1');
  await expect(verschoben).toHaveValue('0,4', { timeout: 15_000 });

  // Typed amounts of a dish someone else takes off the meal are shown to copy
  await aufklappen(zweites, '1_4_1', 'Nudeln');
  await zweites.getByRole('button', { name: 'Nudeln aus 1_4_1 entfernen' }).click();
  await answerConfirm(zweites, 'Nudeln aus 1_4 nehmen?', 'Entfernen');
  await expect(
    zweites.getByRole('list', { name: 'Gerichte bei 1_4' }).getByRole('listitem')
  ).toHaveCount(0);
  await zweites.context().close();
  await expect(page.getByText(/dein Verbrauch: Nudeln \(Spaghetti\) 0,4 g\)/).first()).toBeVisible({
    timeout: 15_000,
  });
});
