import type { Locator, Page } from '@playwright/test';
import { test, expect, answerConfirm } from './fixtures';
import { anlegen } from './essensplanung-helpers';

/**
 * „Gericht generieren lassen (KI)“ with the demo AI of the mock API
 * (`dev/mock-data/essensplanung-ki-gericht.ts`): the written dish is only saved once confirmed.
 */

async function gericht(page: Page, name: string): Promise<Locator> {
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill(name);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText(`${name} angelegt.`).first()).toBeVisible();
  return page.locator('li', { has: page.getByText(name, { exact: true }) }).first();
}

test('a dish written by the AI is taken over with people, lines, instructions and tools', async ({
  page,
}) => {
  await anlegen(page, 'E2E KI Gericht');
  const karte = await gericht(page, 'Nudelpfanne');
  await karte.getByRole('button', { name: 'Gericht generieren lassen (KI): Nudelpfanne' }).click();
  const dialog = page.getByRole('dialog', { name: 'Gericht generieren lassen: Nudelpfanne' });
  const beschreibung = dialog.getByLabel('Was soll es geben?');
  // Starts with the name of the dish
  await expect(beschreibung).toHaveValue('Nudelpfanne');
  await beschreibung.fill('Nudelpfanne mit Paprika, vegetarisch, unbekannt');
  await dialog.getByRole('button', { name: 'Gericht generieren' }).click();

  // The dish has no people yet: the AI's number is offered and the amounts stay as written
  await expect(
    dialog.getByText('Von der KI geschrieben und ungeprüft.', { exact: false })
  ).toBeVisible();
  await expect(dialog.getByLabel('Personenzahl 10 für das Gericht übernehmen')).toBeChecked();
  await expect(dialog.getByTestId('rezept-zeile')).toHaveCount(7);
  await expect(dialog.getByLabel('Zutat für 1.5 kg Nudeln (Spaghetti)')).toHaveValue(
    'Nudeln (Spaghetti)'
  );
  const unbekannt = dialog.getByTestId('rezept-zeile').filter({ hasText: 'Drachenfrucht-Pesto' });
  await expect(unbekannt.getByText('nicht in der Liste, bitte wählen')).toBeVisible();
  // Instructions and tools are shown to change before taking over
  await expect(dialog.getByTestId('generiert-anleitung-an')).toBeChecked();
  await expect(dialog.getByLabel('Anleitung', { exact: true })).toHaveValue(
    /Wasser für die Nudeln/
  );
  await expect(dialog.getByText('Werkzeuge übernehmen')).toBeVisible();
  await expect(dialog.getByText('Nudelsieb')).toBeVisible();

  await dialog.getByRole('button', { name: 'Gericht übernehmen' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(
      '6 Zutaten, Anleitung und Werkzeuge übernommen, Nudelpfanne ist jetzt für 10 Personen.'
    )
  ).toBeVisible();
  await expect(karte.getByText('Mengen für 10 Personen')).toBeVisible();
  await expect(karte.getByLabel('Personen')).toHaveValue('10');
  await expect(karte.getByText('Großer Topf', { exact: true })).toBeVisible();
});

test('a dish with people gets amounts for them, and discarding asks first', async ({ page }) => {
  await anlegen(page, 'E2E KI Gericht Personen');
  const karte = await gericht(page, 'Eintopf');
  await karte.getByRole('button', { name: 'Gericht generieren lassen (KI): Eintopf' }).click();
  let dialog = page.getByRole('dialog', { name: 'Gericht generieren lassen: Eintopf' });
  // Nothing typed yet: closing needs no question
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toBeHidden();

  await karte.getByLabel('Personen').fill('20');
  await karte.getByRole('button', { name: 'Gericht speichern' }).click();
  await expect(page.getByText('Eintopf gespeichert.')).toBeVisible();

  await karte.getByRole('button', { name: 'Gericht generieren lassen (KI): Eintopf' }).click();
  dialog = page.getByRole('dialog', { name: 'Gericht generieren lassen: Eintopf' });
  await dialog.getByRole('button', { name: 'Gericht generieren' }).click();
  // Written for the 20 people of the dish, nothing to take over about people
  await expect(dialog.getByLabel('Menge für 3 kg Nudeln (Spaghetti)')).toHaveValue('3');
  await expect(dialog.getByText(/Personenzahl .* übernehmen/)).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Zurück zur Beschreibung' }).click();
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await answerConfirm(page, 'Gericht verwerfen?', 'Verwerfen');
  await expect(dialog).toBeHidden();
  await expect(karte.getByText('Mengen für 20 Personen')).toBeVisible();
});
