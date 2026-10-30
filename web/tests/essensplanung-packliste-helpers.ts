import type { Page } from '@playwright/test';
import { expect } from './fixtures';

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
