import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { planungVorbereiten } from './essensplanung-vorbereitung';

/** Setup of the packing list specs: dishes with tools, planned, sent as the page would. */

export interface Ansicht {
  tage: {
    mahlzeiten: { id: number; einplanungen: { id: number; etag: string; gerichtId: number }[] }[];
  }[];
  gerichte: { id: number; name: string }[];
}

/** Sends a request of the Planung with the token of the page's link, as the page would. */
export async function senden<T = Ansicht>(
  page: Page,
  method: 'POST' | 'GET' | 'DELETE',
  path: string,
  data?: object,
  ifMatch?: string
): Promise<T> {
  const token = /[#&]t=([\w-]{43})/.exec(page.url())?.[1];
  expect(token, 'the link of the page').toBeTruthy();
  const antwort = await page.request.fetch(`/api/essensplanung/planung${path}`, {
    method,
    headers: {
      'x-essensplanung-token': token!,
      'content-type': 'application/json',
      ...(ifMatch ? { 'if-match': ifMatch } : {}),
    },
    ...(data ? { data } : {}),
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
  return (await antwort.json()) as T;
}

/** Dishes with tools, planned at lunch on both days; the waffles are not planned. */
const GERICHTE: [string, string[]][] = [
  ['Chili', ['Großer Topf', 'Kochlöffel']],
  ['Suppe', [' großer  TOPF', 'Pürierstab']],
  ['Waffeln', ['Waffeleisen']],
];

/** Creates the dishes; Chili at lunch on both days and Suppe on the first, the rest unplanned. */
export async function gerichteMitWerkzeugen(page: Page, gerichte = GERICHTE): Promise<void> {
  const ids: Record<string, number> = {};
  for (const [name, werkzeuge] of gerichte) {
    ids[name] = (
      await senden<{ id: number }>(page, 'POST', '/gerichte', {
        name,
        personen: 10,
        werkzeuge,
      })
    ).id;
  }
  const ansicht = await senden(page, 'GET', '');
  const [tag1, tag2] = ansicht.tage;
  for (const [mahlzeitId, gerichtId] of [
    [tag1.mahlzeiten[1].id, ids.Chili],
    [tag1.mahlzeiten[1].id, ids.Suppe],
    [tag2.mahlzeiten[1].id, ids.Chili],
  ]) {
    await senden(page, 'POST', '/einplanungen', { mahlzeitId, gerichtId });
  }
  await page.reload();
  await page.getByRole('tab', { name: 'Packliste' }).click();
}

/**
 * Creates the Planung `name` over the API with the dishes of `gerichteMitWerkzeugen` planned the
 * same way and opens its tab „Packliste“.
 */
export function packlisteVorbereiten(
  page: Page,
  name: string,
  gerichte: [string, string[]][] = GERICHTE
): Promise<void> {
  const geplant: Record<string, string[]> = { Chili: ['1_2', '2_2'], Suppe: ['1_2'] };
  return planungVorbereiten(page, name, {
    gerichte: gerichte.map(([gericht, werkzeuge]) => ({
      name: gericht,
      personen: 10,
      werkzeuge,
      mahlzeiten: geplant[gericht] ?? [],
    })),
    tab: 'Packliste',
  });
}

/**
 * Opens the choice of who packs `was` (the button in the list or „Wer packt?“ in the matrix),
 * ticks members by name and adds free names, then saves.
 */
export async function werWaehlen(
  page: Page,
  was: string,
  wahl: { mitglieder?: string[]; namen?: string[]; alle?: boolean; niemand?: boolean },
  speichern = 'Speichern'
): Promise<void> {
  await page
    .getByRole('button', { name: `Wer packt ${was} ein?` })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: `Wer packt ${was} ein?` });
  await expect(dialog).toBeVisible();
  if (wahl.niemand) await dialog.getByRole('button', { name: 'Niemand', exact: true }).click();
  if (wahl.alle) await dialog.getByRole('button', { name: 'Alle', exact: true }).click();
  for (const name of wahl.mitglieder ?? [])
    await dialog.getByRole('checkbox', { name, exact: true }).setChecked(true);
  for (const name of wahl.namen ?? []) {
    await dialog.getByRole('textbox', { name: 'Anderer Name' }).fill(name);
    await dialog.getByRole('textbox', { name: 'Anderer Name' }).press('Enter');
  }
  await dialog.getByRole('button', { name: speichern, exact: true }).click();
  await expect(dialog).toBeHidden();
}
