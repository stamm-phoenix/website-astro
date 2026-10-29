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
