import { test, expect, answerConfirm, expectNoHorizontalOverflow } from './fixtures';
import { anlegen, pdfLaden } from './essensplanung-helpers';

test('dishes are ticked off as cooked or left out; the stock and the list follow', async ({
  page,
  browser,
}) => {
  test.slow();
  await anlegen(page, 'E2E Kochen');
  const dialog = page.getByRole('dialog');

  // Pasta for 4: 500 g and salt to taste; 8 people eat it at lunch on both days
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

  // 1,5 kg in stock: 2 × 1 kg needed, 500 g to buy
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  await page.getByRole('button', { name: 'Bestand eintragen' }).click();
  await dialog.getByLabel('Zutat', { exact: true }).fill('Nudeln (Spag');
  await dialog.getByRole('option', { name: 'Nudeln (Spaghetti)' }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('1,5');
  await dialog.getByLabel('Einheit', { exact: true }).selectOption('kg');
  await dialog.getByRole('button', { name: 'Eintragen' }).click();
  await expect(dialog).toBeHidden();
  const liste = page.getByRole('list', { name: 'Ohne Geschäft: Teigware' });
  await expect(liste).toContainText('500 g Nudeln (Spaghetti)');

  // The first lunch is cooked, but only 800 g were used
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByLabel('Nudeln bei 1_2_1 abhaken').click();
  const verbrauch = page.getByLabel('Verbrauch von Nudeln (Spaghetti) bei 1_2_1');
  await expect(verbrauch).toHaveValue('1');
  await verbrauch.fill('0,8');
  await page.getByRole('button', { name: 'Gekocht', exact: true }).click();
  await expect(page.getByText('Nudeln ist als gekocht abgehakt.').first()).toBeVisible();
  const mittag = page.getByRole('list', { name: 'Gerichte bei 1_2' });
  await expect(mittag.getByText('gekocht', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Others see it; the stock has 700 g left, so 300 g of the second lunch are bought
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Einkauf' }).click();
  await expect(anderes.getByRole('list', { name: 'Ohne Geschäft: Teigware' })).toContainText(
    '300 g Nudeln (Spaghetti)'
  );
  const lager = anderes.getByRole('table');
  await expect(lager.getByRole('row', { name: /Nudeln \(Spaghetti\)/ })).toContainText(
    /1,5 kg\s*800 g\s*700 g/
  );
  const pdf = await pdfLaden(anderes, () =>
    anderes.getByRole('button', { name: 'Lager als PDF' }).click()
  );
  expect(pdf.text).toContain('700 g');
  await anderes.context().close();

  // The second lunch is left out: nothing more to buy, the stock stays
  await page.getByLabel('Nudeln bei 2_2_1 abhaken').click();
  await page.getByRole('button', { name: 'Ausgelassen' }).click();
  await expect(page.getByText('Nudeln ist als ausgelassen abgehakt.').first()).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Gerichte bei 2_2' }).getByText('ausgelassen', { exact: true })
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  await expect(page.getByText('Noch nichts zu kaufen.')).toBeVisible();

  // Not used at all: the first lunch used nothing, so the stock is full again
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByLabel('Nudeln bei 1_2_1 abhaken').click();
  await page.getByLabel('Nudeln (Spaghetti) bei 1_2_1 verwendet').uncheck();
  await page.getByRole('button', { name: 'Verbrauch speichern' }).click();
  await expect(page.getByText('Nudeln ist als gekocht abgehakt.').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  await expect(page.getByRole('table').getByRole('row', { name: /Nudeln/ })).toContainText(
    /1,5 kg\s*0 g\s*1,5 kg/
  );

  // Open again: it is needed again, and the stock covers it
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByLabel('Nudeln bei 1_2_1 abhaken').click();
  await page.getByRole('button', { name: 'Wieder offen' }).click();
  await expect(page.getByText('Nudeln ist wieder offen.').first()).toBeVisible();
  await expect(mittag.getByText('gekocht', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Einkauf' }).click();
  await expect(page.getByText('Noch nichts zu kaufen.')).toBeVisible();
});

test('amounts typed to tick off a dish stay through maintenance', async ({ page }) => {
  await anlegen(page, 'E2E Kochen Wartung');
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
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Gericht einplanen bei 1_2' }).click();
  await dialog.getByLabel('Gericht', { exact: true }).selectOption({ label: 'Nudeln' });
  await dialog.getByRole('button', { name: 'Einplanen' }).click();
  await expect(dialog).toBeHidden();

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
  await page.getByLabel('Nudeln bei 1_2_1 abhaken').click();
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

  // Folding it away and opening it again keeps the amounts; discarding takes the planned ones
  const abhaken = page.getByLabel('Nudeln bei 1_2_1 abhaken');
  await abhaken.click();
  await expect(verbrauch).toBeHidden();
  await abhaken.click();
  await expect(verbrauch).toHaveValue('0,3');
  await page.getByRole('button', { name: 'Eingaben verwerfen' }).click();
  await expect(verbrauch).not.toHaveValue('0,3');
  await expect(page.getByRole('button', { name: 'Eingaben verwerfen' })).toBeHidden();
});

test('ticking off after someone else did keeps the amounts and saves them on the second try', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E Kochen Konflikt');
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
  await page.getByRole('tab', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Gericht einplanen bei 1_2' }).click();
  await dialog.getByLabel('Gericht', { exact: true }).selectOption({ label: 'Nudeln' });
  await dialog.getByRole('button', { name: 'Einplanen' }).click();
  await expect(dialog).toBeHidden();

  await page.getByLabel('Nudeln bei 1_2_1 abhaken').click();
  const verbrauch = page.getByLabel('Verbrauch von Nudeln (Spaghetti) bei 1_2_1');
  await verbrauch.fill('0,3');

  // Someone else leaves it out meanwhile
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByLabel('Nudeln bei 1_2_1 abhaken').click();
  await anderes.getByRole('button', { name: 'Ausgelassen' }).click();
  await expect(anderes.getByText('Nudeln ist als ausgelassen abgehakt.').first()).toBeVisible();
  await anderes.context().close();

  await page.getByRole('button', { name: 'Gekocht', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Jetzt gespeichert: ausgelassen.' })
  ).toBeVisible();
  await expect(verbrauch).toHaveValue('0,3');
  await page.getByRole('button', { name: 'Gekocht', exact: true }).click();
  await expect(page.getByText('Nudeln ist als gekocht abgehakt.').first()).toBeVisible();
  await page.getByLabel('Nudeln bei 1_2_1 abhaken').click();
  await expect(verbrauch).toHaveValue('0,3');

  // Typed amounts of a dish someone else takes off the meal are shown to copy
  await verbrauch.fill('0,4');
  await page.getByLabel('Nudeln bei 1_2_1 abhaken').click();
  const zweites = await (await browser.newContext()).newPage();
  await zweites.goto(page.url());
  await zweites
    .getByRole('list', { name: 'Gerichte bei 1_2' })
    .getByRole('button', { name: 'Nudeln aus 1_2 entfernen' })
    .click();
  await answerConfirm(zweites, 'Nudeln aus 1_2 nehmen?', 'Entfernen');
  await expect(zweites.getByRole('list', { name: 'Gerichte bei 1_2' })).toHaveCount(0);
  await zweites.context().close();
  await expect(page.getByText(/dein Verbrauch: Nudeln \(Spaghetti\) 0,4 g\)/).first()).toBeVisible({
    timeout: 15_000,
  });
});
