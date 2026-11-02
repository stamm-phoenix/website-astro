import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';
import { anlegen, einplanen } from './essensplanung-helpers';

/** Pasta for 4 (500 g), eaten by 8 at lunch on both days: 1 kg each. */
export async function nudelnPlanen(page: Page, name: string): Promise<void> {
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
  for (const mahlzeit of ['1_2', '2_2']) await einplanen(page, mahlzeit, 'Nudeln');
  await page.getByRole('tab', { name: 'Einkauf' }).click();
}

/** Adds a trip; `bis` is the index of the last meal in the choice (0: all meals). */
export async function einkaufAnlegen(page: Page, name: string, bis: number): Promise<void> {
  await page.getByRole('button', { name: 'Einkauf anlegen' }).click();
  const form = page.getByRole('form', { name: 'Neuer Einkauf' });
  await form.getByLabel('Name des Einkaufs').fill(name);
  await form.getByLabel('Für die Mahlzeiten bis').selectOption({ index: bis });
  await form.getByRole('button', { name: 'Einkauf anlegen' }).click();
  await expect(page.getByText(`${name} angelegt.`).first()).toBeVisible();
}

/** A trip shown on its own. */
export const karte = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

/** Back to the overview of the trips, if a trip is shown. */
export async function uebersicht(page: Page): Promise<void> {
  const zurueck = page.getByRole('button', { name: 'Zurück zu den Einkäufen' });
  if (await zurueck.count()) await zurueck.click();
  await expect(page.getByRole('list', { name: 'Einkäufe' })).toBeVisible();
}

/** Opens a trip from the overview, to shop with or with its list to change. */
export async function oeffnen(page: Page, name: string, modus: 'live' | 'liste' = 'live') {
  await uebersicht(page);
  await page.getByRole('button', { name: `${name}: Einkaufen` }).click();
  const einkauf = karte(page, name);
  await expect(einkauf).toBeVisible();
  if (modus === 'liste') await einkauf.getByRole('button', { name: 'Liste anpassen' }).click();
  return einkauf;
}

/** The box that ticks a thing off or takes the tick back. */
export const box = (einkauf: Locator, name: string) =>
  einkauf.getByRole('checkbox', { name: `${name} abhaken` });
