import { test, expect, expectNoHorizontalOverflow, answerConfirm } from './fixtures';
import { liveFeld } from './essensplanung-helpers';
import { oeffnen, box } from './essensplanung-einkaeufe-helpers';
import { nudelnVorbereiten } from './essensplanung-vorbereitung';

test('a change of a trip keeps its draft while the list is looked at', async ({ page }) => {
  test.slow();
  await nudelnVorbereiten(page, 'E2E Einkäufe Entwurf', { einkaeufe: ['Montag'] });
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
  await nudelnVorbereiten(page, 'E2E Einkäufe verloren', { einkaeufe: ['Montag', 'Mittwoch'] });
  // Wednesday buys nothing yet: everything is on Monday. Monday is ticked off with less, so the
  // rest is on Wednesday
  const montag = await oeffnen(page, 'Montag');
  await (await liveFeld(montag, 'Erhaltene Menge von Nudeln (Spaghetti)')).fill('1');
  await montag.getByRole('button', { name: 'Abhaken' }).click();
  await expect(montag.getByRole('status')).toHaveText('1 von 1 abgehakt');
  const mittwoch = await oeffnen(page, 'Mittwoch');
  await (await liveFeld(mittwoch, 'Erhaltene Menge von Nudeln (Spaghetti)')).fill('800');
  await (await liveFeld(mittwoch, 'Einheit von Nudeln (Spaghetti)')).selectOption('g');
  await (await liveFeld(mittwoch, 'Ersatz für Nudeln (Spaghetti)')).fill('Vollkornnudeln');

  // Someone else changes Monday to all of it: Wednesday needs nothing more
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Einkauf' }).click();
  const dort = await oeffnen(anderes, 'Montag');
  await (await liveFeld(dort, 'Erhaltene Menge von Nudeln (Spaghetti)')).fill('2');
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
  await nudelnVorbereiten(page, 'E2E Einkäufe Entwürfe', {
    zusatz: ['Kochhandschuhe'],
    einkaeufe: ['Montag'],
  });
  const montag = await oeffnen(page, 'Montag');
  const menge = await liveFeld(montag, 'Erhaltene Menge von Nudeln (Spaghetti)');
  await menge.fill('800');
  await (await liveFeld(montag, 'Einheit von Nudeln (Spaghetti)')).selectOption('g');
  await (await liveFeld(montag, 'Ersatz für Nudeln (Spaghetti)')).fill('Vollkornnudeln');
  // Ticking off another thing keeps it
  await box(montag, 'Kochhandschuhe').click();
  await expect(montag.getByRole('status')).toHaveText('1 von 2 abgehakt');
  await expect(menge).toHaveValue('800');
  await expect(montag.getByLabel('Ersatz für Nudeln (Spaghetti)')).toHaveValue('Vollkornnudeln');

  // Too much: the row says so and keeps the input
  await menge.fill('1000001');
  await (await liveFeld(montag, 'Einheit von Nudeln (Spaghetti)')).selectOption('kg');
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
  await nudelnVorbereiten(page, 'E2E Einkäufe Handy', { einkaeufe: ['Montag'] });
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

test('leaving the page with live input asks first, and once it is discarded asks no more', async ({
  page,
}) => {
  test.slow();
  await nudelnVorbereiten(page, 'E2E Einkäufe Verlassen', { einkaeufe: ['Montag'] });
  const montag = await oeffnen(page, 'Montag');
  const menge = await liveFeld(montag, 'Erhaltene Menge von Nudeln (Spaghetti)');
  await menge.fill('800');
  await (await liveFeld(montag, 'Ersatz für Nudeln (Spaghetti)')).fill('Vollkornnudeln');
  await page.getByRole('link', { name: 'Impressum' }).click();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Weiter bearbeiten');
  await expect(page).toHaveURL(/\/essensplanung\/planung/);
  await expect(menge).toHaveValue('800');
  await expect(montag.getByLabel('Ersatz für Nudeln (Spaghetti)')).toHaveValue('Vollkornnudeln');

  // Discarded: back to the planning and away again without the browser loading anew, no question
  await page.getByRole('link', { name: 'Impressum' }).click();
  await answerConfirm(page, 'Änderungen verwerfen?', 'Änderungen verwerfen');
  await expect(page).toHaveURL(/\/impressum/);
  for (let mal = 0; mal < 2; mal++) {
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'E2E Einkäufe Verlassen' })).toBeVisible();
    await page.getByRole('link', { name: 'Impressum' }).click();
    await expect(page).toHaveURL(/\/impressum/);
    await expect(page.getByRole('dialog', { name: 'Änderungen verwerfen?' })).toHaveCount(0);
  }
});

test('what is typed in the live mode stays while the trip shows its list or is left', async ({
  page,
}) => {
  test.slow();
  await nudelnVorbereiten(page, 'E2E Einkäufe Ansicht', { einkaeufe: ['Montag'] });
  const montag = await oeffnen(page, 'Montag');
  const menge = await liveFeld(montag, 'Erhaltene Menge von Nudeln (Spaghetti)');
  await menge.fill('800');
  await (await liveFeld(montag, 'Einheit von Nudeln (Spaghetti)')).selectOption('g');
  await (await liveFeld(montag, 'Ersatz für Nudeln (Spaghetti)')).fill('Vollkornnudeln');
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

test('what is typed while ticking off is saved stays as a new change', async ({ page }) => {
  test.slow();
  await nudelnVorbereiten(page, 'E2E Einkäufe Weitertippen', { einkaeufe: ['Montag'] });
  const montag = await oeffnen(page, 'Montag');
  const menge = await liveFeld(montag, 'Erhaltene Menge von Nudeln (Spaghetti)');
  const ersatz = await liveFeld(montag, 'Ersatz für Nudeln (Spaghetti)');
  await menge.fill('800');
  await (await liveFeld(montag, 'Einheit von Nudeln (Spaghetti)')).selectOption('g');
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
  await nudelnVorbereiten(page, 'E2E Einkäufe feste Menge', {
    zusatz: ['Kochhandschuhe'],
    einkaeufe: ['Montag'],
  });
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
