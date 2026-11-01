import type { Locator, Page } from '@playwright/test';
import { test, expect, answerConfirm } from './fixtures';
import { anlegen } from './essensplanung-helpers';

/**
 * The preview of a recipe read by the demo AI: going back to the text keeps the corrections,
 * a deletion by others shows the text to copy, and the rows are easy to hit on a phone.
 */

async function gericht(page: Page, name: string, personen: string): Promise<Locator> {
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill(name);
  await page.locator('#gericht-neu-personen').fill(personen);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText(`${name} angelegt.`).first()).toBeVisible();
  return page.locator('li', { has: page.getByText(name, { exact: true }) }).first();
}

const REZEPT = '500 g Zwiebeln\n1 Prise Salz';

test('back to the text and forward keeps the corrections; reading again asks', async ({ page }) => {
  await anlegen(page, 'E2E KI Vorschau');
  const karte = await gericht(page, 'Suppe', '4');
  await karte.getByRole('button', { name: 'Rezept einfügen (KI)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rezept für Suppe' });
  await dialog.getByLabel('Rezept', { exact: true }).fill(REZEPT);
  await dialog.getByRole('button', { name: 'Zutaten erkennen' }).click();
  await dialog.getByLabel('Menge für 500 g Zwiebeln').fill('600');
  await dialog.getByRole('checkbox', { name: '1 Prise Salz übernehmen' }).uncheck();

  await dialog.getByRole('button', { name: 'Zurück zum Text' }).click();
  await expect(dialog.getByLabel('Rezept', { exact: true })).toHaveValue(REZEPT);
  await dialog.getByRole('button', { name: 'Zur Vorschau' }).click();
  await expect(dialog.getByLabel('Menge für 500 g Zwiebeln')).toHaveValue('600');
  await expect(dialog.getByRole('checkbox', { name: '1 Prise Salz übernehmen' })).not.toBeChecked();

  // Reading again would replace the corrections: it asks first
  await dialog.getByRole('button', { name: 'Zurück zum Text' }).click();
  await dialog.getByRole('button', { name: 'Zutaten erkennen' }).click();
  const frage = page.getByRole('dialog', { name: 'Zutaten neu erkennen?' });
  await expect(frage.getByText('Deine Korrekturen in der Vorschau gehen verloren.')).toBeVisible();
  await answerConfirm(page, 'Zutaten neu erkennen?', 'Abbrechen');
  await dialog.getByRole('button', { name: 'Zur Vorschau' }).click();
  await expect(dialog.getByLabel('Menge für 500 g Zwiebeln')).toHaveValue('600');
  await dialog.getByRole('button', { name: 'Zurück zum Text' }).click();
  await dialog.getByRole('button', { name: 'Zutaten erkennen' }).click();
  await answerConfirm(page, 'Zutaten neu erkennen?', 'Neu erkennen');
  await expect(dialog.getByLabel('Menge für 500 g Zwiebeln')).toHaveValue('500');
  await expect(dialog.getByRole('checkbox', { name: '1 Prise Salz übernehmen' })).toBeChecked();

  // A changed text has to be read again
  await dialog.getByRole('button', { name: 'Zurück zum Text' }).click();
  await dialog.getByLabel('Rezept', { exact: true }).fill(`${REZEPT}\n2 EL Olivenöl`);
  await expect(dialog.getByRole('button', { name: 'Zur Vorschau' })).toHaveCount(0);
});

test('a dish deleted by someone else shows the pasted recipe to copy', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E KI Rezept weg');
  const karte = await gericht(page, 'Eintopf', '4');
  await karte.getByRole('button', { name: 'Rezept einfügen (KI)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rezept für Eintopf' });
  await dialog.getByLabel('Rezept', { exact: true }).fill(REZEPT);
  await dialog.getByRole('button', { name: 'Zutaten erkennen' }).click();
  await dialog.getByLabel('Menge für 500 g Zwiebeln').fill('600');

  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText('Eintopf', { exact: true }).click();
  await anderes.getByRole('button', { name: 'Gericht löschen' }).click();
  await answerConfirm(anderes, '„Eintopf“ löschen?', 'Gericht löschen');
  await expect(anderes.getByText('Eintopf gelöscht.').first()).toBeVisible();
  await page.bringToFront();
  await expect(
    page
      .getByText(
        '„Eintopf“ wurde gerade gelöscht, das Rezept wurde nicht übernommen (eine bearbeitete Vorschauzeile). Dein eingefügter Text: 500 g Zwiebeln 1 Prise Salz'
      )
      .first()
  ).toBeVisible({ timeout: 15_000 });
  await anderes.context().close();
});

test('discarding on purpose or taking over says nothing about lost input', async ({ page }) => {
  await anlegen(page, 'E2E KI Rezept verworfen');
  const karte = await gericht(page, 'Brei', '4');
  await karte.getByRole('button', { name: 'Rezept einfügen (KI)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rezept für Brei' });
  await dialog.getByLabel('Rezept', { exact: true }).fill(REZEPT);
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await answerConfirm(page, 'Rezept verwerfen?', 'Verwerfen');
  await expect(dialog).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page.getByText(/das Rezept wurde nicht übernommen/)).toHaveCount(0);
});

test('the checkbox of a preview row has a touch area of at least 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await anlegen(page, 'E2E KI Fläche');
  const karte = await gericht(page, 'Salat', '4');
  await karte.getByRole('button', { name: 'Rezept einfügen (KI)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rezept für Salat' });
  await dialog.getByLabel('Rezept', { exact: true }).fill(REZEPT);
  await dialog.getByRole('button', { name: 'Zutaten erkennen' }).click();
  const box = dialog
    .getByTestId('rezept-zeile-an')
    .filter({ has: page.getByRole('checkbox', { name: '1 Prise Salz übernehmen' }) });
  expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // A tap on the text of the row toggles it
  await box.getByText('Rezept: 1 Prise Salz').click();
  await expect(dialog.getByRole('checkbox', { name: '1 Prise Salz übernehmen' })).not.toBeChecked();
});

test('an error of the whole take-over is named in the dialog', async ({ page }) => {
  await anlegen(page, 'E2E KI Zu viele');
  const karte = await gericht(page, 'Buffet', '4');
  await karte.getByRole('button', { name: 'Rezept einfügen (KI)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rezept für Buffet' });
  await dialog.getByLabel('Rezept', { exact: true }).fill(REZEPT);
  await dialog.getByRole('button', { name: 'Zutaten erkennen' }).click();
  // As the API answers when the dish would get more than 60 lines
  await page.route('**/api/essensplanung/planung/gerichte/*/zutaten/sammel', (route) =>
    route.fulfill({
      status: 400,
      json: {
        error: 'INVALID',
        code: 'INVALID',
        message: 'Die Eingaben sind unvollständig oder ungültig.',
        fields: { zutat: 'Ein Gericht hat höchstens 60 Zutaten.' },
      },
    })
  );
  await dialog.getByRole('button', { name: '2 Zutaten übernehmen' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Ein Gericht hat höchstens 60 Zutaten. Es wurde nichts übernommen. Bitte wähle Zutaten ab und übernimm noch einmal.'
  );
  await expect(dialog.getByTestId('rezept-zeile')).toHaveCount(2);
});

test('an ingredient first used meanwhile is still recognised from the list', async ({ page }) => {
  await anlegen(page, 'E2E KI Erste Verwendung');
  const karte = await gericht(page, 'Suppe', '4');
  await karte.getByRole('button', { name: 'Rezept einfügen (KI)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rezept für Suppe' });
  await dialog.getByLabel('Rezept', { exact: true }).fill('500 g Zwiebeln');

  // The recognition answers for the central list; before the answer arrives, someone uses
  // onions for the first time, so they become an ingredient of the Planung
  const url = new URL(page.url());
  const headers = {
    'x-essensplanung-token': new URLSearchParams(url.hash.slice(1)).get('t')!,
  };
  const base = `${url.origin}/api/essensplanung/planung`;
  let freigeben!: () => void;
  const frei = new Promise<void>((resolve) => (freigeben = resolve));
  await page.route('**/api/essensplanung/planung/gerichte/*/ki/rezept', async (route) => {
    const antwort = await route.fetch();
    await frei;
    await route.fulfill({ response: antwort });
  });
  await dialog.getByRole('button', { name: 'Zutaten erkennen' }).click();
  const katalog = await (await page.request.get(`${base}/katalog`, { headers })).json();
  const zwiebeln = katalog.zutaten.find((z: { name: string }) => z.name === 'Zwiebeln');
  const ansicht = await (await page.request.get(base, { headers })).json();
  const suppe = ansicht.gerichte.find((g: { name: string }) => g.name === 'Suppe');
  const neu = await page.request.post(`${base}/gerichte/${suppe.id}/zutaten`, {
    headers,
    data: { zutatId: zwiebeln.id, menge: 1, einheit: 'kg' },
  });
  expect(neu.ok()).toBe(true);
  await expect(karte.getByLabel('Menge von Zwiebeln', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  freigeben();

  await expect(dialog.getByLabel('Zutat für 500 g Zwiebeln')).toHaveValue('Zwiebeln');
  await expect(dialog.getByText('nicht in der Liste, bitte wählen')).toHaveCount(0);
  await expect(dialog.getByRole('checkbox', { name: '500 g Zwiebeln übernehmen' })).toBeChecked();
  await expect(dialog.getByLabel('Einheit für 500 g Zwiebeln')).toHaveValue('g');
});

test('a recipe sets the people of a dish without any in the same save, never half of it', async ({
  page,
  browser,
}) => {
  await anlegen(page, 'E2E KI Personen');
  const karte = await gericht(page, 'Suppe', '');
  await expect(karte.getByText('Personenzahl fehlt').first()).toBeVisible();
  await karte.getByRole('button', { name: 'Rezept einfügen (KI)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rezept für Suppe' });
  await dialog.getByLabel('Rezept', { exact: true }).fill(`Für 4 Personen\n${REZEPT}`);
  await dialog.getByRole('button', { name: 'Zutaten erkennen' }).click();
  // The amounts stay as written; the number of the recipe is offered for the dish
  await expect(dialog.getByLabel('Menge für 500 g Zwiebeln')).toHaveValue('500');
  const uebernehmen = dialog.getByRole('checkbox', {
    name: 'Personenzahl 4 für das Gericht übernehmen',
  });
  await expect(uebernehmen).toBeChecked();
  await dialog.getByRole('checkbox', { name: '1 Prise Salz übernehmen' }).uncheck();

  // A failed save takes over neither the line nor the people
  await page.route('**/api/essensplanung/planung/gerichte/*/zutaten/sammel', (route) =>
    route.fulfill({ status: 500, json: { error: 'Kaputt' } })
  );
  await dialog.getByRole('button', { name: 'Eine Zutat übernehmen' }).click();
  await expect(dialog.getByRole('alert').first()).toBeVisible();
  await expect(dialog).toBeVisible();
  await page.unroute('**/api/essensplanung/planung/gerichte/*/zutaten/sammel');
  await expect(karte.getByText('Personenzahl fehlt').first()).toBeAttached();
  await expect(karte.getByLabel('Menge von Zwiebeln', { exact: true })).toHaveCount(0);

  // Someone sets 20 people meanwhile: nothing is taken over, the preview offers to scale
  const anderes = await (await browser.newContext()).newPage();
  await anderes.goto(page.url());
  await anderes.getByRole('tab', { name: 'Gerichte' }).click();
  await anderes.getByText('Suppe', { exact: true }).click();
  await anderes
    .locator('li', { has: anderes.getByText('Suppe', { exact: true }) })
    .first()
    .getByLabel('Personen', { exact: true })
    .fill('20');
  await anderes.getByRole('button', { name: 'Gericht speichern' }).click();
  await expect(anderes.getByText('Suppe gespeichert.').first()).toBeVisible();
  await anderes.context().close();
  await page.bringToFront();
  await dialog.getByRole('button', { name: 'Eine Zutat übernehmen' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Mengen auf 20 Personen umrechnen' })
  ).toBeVisible();
  await expect(karte.getByLabel('Menge von Zwiebeln', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Mengen auf 20 Personen umrechnen' }).click();
  await expect(dialog.getByLabel('Menge für 500 g Zwiebeln')).toHaveValue('2500');
  await dialog.getByRole('button', { name: 'Eine Zutat übernehmen' }).click();
  await expect(dialog).toBeHidden();
  await expect(karte.getByLabel('Menge von Zwiebeln', { exact: true })).toHaveValue('2500');
  await expect(karte.getByText('Mengen für 20 Personen')).toBeVisible();

  // Without anyone changing it, the recipe sets the people with its lines
  const zweite = await gericht(page, 'Eintopf', '');
  await zweite.getByRole('button', { name: 'Rezept einfügen (KI)' }).click();
  const zweiterDialog = page.getByRole('dialog', { name: 'Rezept für Eintopf' });
  await zweiterDialog.getByLabel('Rezept', { exact: true }).fill(`Für 4 Personen\n${REZEPT}`);
  await zweiterDialog.getByRole('button', { name: 'Zutaten erkennen' }).click();
  await zweiterDialog.getByRole('checkbox', { name: '1 Prise Salz übernehmen' }).uncheck();
  await zweiterDialog.getByRole('button', { name: 'Eine Zutat übernehmen' }).click();
  await expect(
    page.getByText('Eine Zutat übernommen, Eintopf ist jetzt für 4 Personen.').first()
  ).toBeVisible();
  await expect(zweite.getByText('Mengen für 4 Personen')).toBeVisible();
});
