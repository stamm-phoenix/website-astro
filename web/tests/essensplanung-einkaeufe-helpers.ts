import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { anlegen } from './essensplanung-helpers';

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
  for (const mahlzeit of ['1_2', '2_2']) {
    await page.getByRole('button', { name: `Gericht einplanen bei ${mahlzeit}` }).click();
    await dialog.getByLabel('Gericht', { exact: true }).selectOption({ label: 'Nudeln' });
    await dialog.getByRole('button', { name: 'Einplanen' }).click();
    await expect(dialog).toBeHidden();
  }
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

export const karte = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Einkäufe' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name }) });
