import { test, expect, answerConfirm } from './fixtures';
import { oeffnen, box } from './essensplanung-einkaeufe-helpers';
import { nudelnVorbereiten } from './essensplanung-vorbereitung';

test('deleting a trip after someone ticked something off meanwhile is a conflict', async ({
  page,
  browser,
}) => {
  test.slow();
  await nudelnVorbereiten(page, 'E2E Einkäufe Löschen', { einkaeufe: ['Montag'] });
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
  await nudelnVorbereiten(page, 'E2E Einkäufe feste Menge sperren', {
    zusatz: ['Kochhandschuhe'],
    einkaeufe: ['Montag'],
  });
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
  await nudelnVorbereiten(page, 'E2E Einkäufe Formular sperren', { einkaeufe: ['Montag'] });
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
  await nudelnVorbereiten(page, 'E2E Einkäufe Abbrechen');
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
  await nudelnVorbereiten(page, 'E2E Einkäufe gelöscht', { einkaeufe: ['Montag'] });
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
