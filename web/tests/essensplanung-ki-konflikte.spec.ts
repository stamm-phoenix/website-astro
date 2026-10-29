import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { anlegen, zeilenMenge } from './essensplanung-helpers';

/**
 * The AI of the Essensplanung when others change things meanwhile, late answers and leaving the
 * page, with the demo AI of the mock API.
 */

async function gericht(page: Page, name: string, personen: string): Promise<Locator> {
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByLabel('Neues Gericht').fill(name);
  await page.locator('#gericht-neu-personen').fill(personen);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText(`${name} angelegt.`).first()).toBeVisible();
  return page.locator('li', { has: page.getByText(name, { exact: true }) }).first();
}

/** Calls the API of the Planung with the page's own link, as another member would. */
function api(page: Page) {
  const url = new URL(page.url());
  const token = new URLSearchParams(url.hash.slice(1)).get('t')!;
  const headers = { 'x-essensplanung-token': token };
  const base = `${url.origin}/api/essensplanung/planung`;
  return {
    ansicht: async () => (await page.request.get(base, { headers })).json(),
    patch: (pfad: string, data: unknown) => page.request.patch(`${base}${pfad}`, { headers, data }),
  };
}

/** Whether leaving the page now would ask first (the browser's warning on reload or close). */
function fragtVorDemVerlassen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

test('recipe amounts for old people are refused and scaled again; leaving asks', async ({
  page,
}) => {
  await anlegen(page, 'E2E KI Personen');
  const karte = await gericht(page, 'Gulasch', '8');
  expect(await fragtVorDemVerlassen(page)).toBe(false);
  await karte.getByRole('button', { name: 'Rezept einfügen (KI)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rezept für Gulasch' });
  await dialog.getByLabel('Rezept', { exact: true }).fill('Für 4 Personen\n500 g Zwiebeln');
  // A pasted recipe is not lost by leaving the page by accident
  expect(await fragtVorDemVerlassen(page)).toBe(true);
  await dialog.getByRole('button', { name: 'Zutaten erkennen' }).click();
  await expect(dialog.getByLabel('Menge für 500 g Zwiebeln')).toHaveValue('1000');

  // Someone else changes the people of the dish while the preview is open
  const andere = api(page);
  const ansicht = await andere.ansicht();
  const gulasch = ansicht.gerichte.find((g: { name: string }) => g.name === 'Gulasch');
  expect(
    (await andere.patch(`/gerichte/${gulasch.id}`, { etag: gulasch.etag, personen: 16 })).ok()
  ).toBe(true);

  await dialog.getByRole('button', { name: 'Eine Zutat übernehmen' }).click();
  await expect(dialog.getByRole('alert')).toContainText('inzwischen auf 16 geändert');
  await expect(dialog.getByLabel('Menge für 500 g Zwiebeln')).toHaveValue('1000');
  await dialog.getByRole('button', { name: 'Mengen auf 16 Personen umrechnen' }).click();
  await expect(dialog.getByLabel('Menge für 500 g Zwiebeln')).toHaveValue('2000');
  await dialog.getByRole('button', { name: 'Eine Zutat übernehmen' }).click();
  await expect(page.getByText('Eine Zutat übernommen.').first()).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => zeilenMenge(karte, 'Zwiebeln')).toBe('2000 g');
  // Taken over: nothing left to lose
  expect(await fragtVorDemVerlassen(page)).toBe(false);
});

test('a late estimate is not shown under another ingredient', async ({ page }) => {
  await anlegen(page, 'E2E KI Spät');
  const karte = await gericht(page, 'Pudding', '10');
  await karte.getByRole('button', { name: 'Mehr Angaben …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Zutat für Pudding' });
  await dialog.getByLabel('Zutat', { exact: true }).fill('Zucker (weiß)');
  await dialog.getByRole('option', { name: 'Zucker (weiß)' }).click();
  const schaetzen = dialog.getByRole('group', { name: /In Gramm schätzen lassen \(KI\)/ });

  let freigeben!: () => void;
  const frei = new Promise<void>((resolve) => (freigeben = resolve));
  await page.route('**/api/essensplanung/planung/ki/umrechnung', async (route) => {
    await frei;
    await route.continue();
  });
  await schaetzen.getByLabel('Maß zum Schätzen').selectOption({ label: 'EL' });
  await schaetzen.getByRole('button', { name: 'Schätzen lassen', exact: true }).click();
  await expect(schaetzen.getByRole('button', { name: 'KI schätzt …' })).toBeVisible();
  // Meanwhile another ingredient is chosen; then the answer for sugar arrives
  await dialog.getByLabel('Zutat', { exact: true }).fill('Salz');
  await dialog.getByRole('option', { name: 'Salz', exact: true }).click();
  const antwort = page.waitForResponse('**/api/essensplanung/planung/ki/umrechnung');
  freigeben();
  await antwort;
  await page.waitForTimeout(500);
  await expect(schaetzen.getByText('KI-Schätzung, ungeprüft:')).toHaveCount(0);
  await expect(
    schaetzen.getByRole('button', { name: 'Schätzen lassen', exact: true })
  ).toBeEnabled();
});

test('a proposal is not saved over a change of others', async ({ page }) => {
  await anlegen(page, 'E2E KI Fremd');
  const karte = await gericht(page, 'Chili', '10');
  await karte.getByRole('button', { name: 'Mehr Angaben …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Zutat für Chili' });
  await dialog.getByLabel('Zutat', { exact: true }).fill('Hackfl');
  await dialog.getByRole('option', { name: 'Hackfleisch' }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('500');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect.poll(() => zeilenMenge(karte, 'Hackfleisch')).toBe('500 g');
  await karte.getByRole('button', { name: 'Gericht prüfen (KI)' }).click();
  const hinweise = karte.getByRole('status').filter({ hasText: 'KI-Hinweise zu Chili' });
  await expect(hinweise.getByText('Die Menge wirkt für 10 Personen knapp.')).toBeVisible();

  // Right after this page's write, someone else saves the same line; the answer shows that
  const andere = api(page);
  await page.route(
    '**/api/essensplanung/planung/gericht-zutaten/*',
    async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      const antwort = await route.fetch();
      const id = Number(new URL(route.request().url()).pathname.split('/').pop());
      const zeile = (await antwort.json()).gerichte
        .flatMap((g: { zutaten: { id: number }[] }) => g.zutaten)
        .find((z: { id: number }) => z.id === id);
      expect(
        (await andere.patch(`/gericht-zutaten/${id}`, { ...zeile, hinweis: 'von nebenan' })).ok()
      ).toBe(true);
      await route.fulfill({ response: antwort, json: await andere.ansicht() });
    },
    { times: 1 }
  );
  await hinweise
    .getByRole('button', { name: 'Vorschlag für Hackfleisch übernehmen: 1.000 g' })
    .click();
  await expect(page.getByText('Vorschlag für Hackfleisch übernommen.').first()).toBeVisible();
  await expect(hinweise.getByText(/inzwischen auch anderweitig geändert/)).toBeVisible();
  await expect(
    hinweise.getByRole('button', { name: /Vorschlag für Hackfleisch übernehmen: nicht für/ })
  ).toHaveCount(0);
  await expect(karte.getByLabel('Hinweis zu Hackfleisch')).toHaveValue('von nebenan');
});

test('a proposed amount is not taken over once the people of the dish changed', async ({
  page,
}) => {
  await anlegen(page, 'E2E KI Personen Prüfen');
  const karte = await gericht(page, 'Chili', '10');
  await karte.getByRole('button', { name: 'Mehr Angaben …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Zutat für Chili' });
  await dialog.getByLabel('Zutat', { exact: true }).fill('Hackfl');
  await dialog.getByRole('option', { name: 'Hackfleisch' }).click();
  await dialog.getByLabel('Menge', { exact: true }).fill('500');
  await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect.poll(() => zeilenMenge(karte, 'Hackfleisch')).toBe('500 g');
  await karte.getByRole('button', { name: 'Gericht prüfen (KI)' }).click();
  const hinweise = karte.getByRole('status').filter({ hasText: 'KI-Hinweise zu Chili' });
  await expect(hinweise.getByText('Die Menge wirkt für 10 Personen knapp.')).toBeVisible();

  // Someone else doubles the people; this page has not heard of it yet
  await page.route('**/api/essensplanung/planung/stand?*', (route) =>
    route.fulfill({ json: { stand: new URL(route.request().url()).searchParams.get('seit') } })
  );
  const andere = api(page);
  const chili = (await andere.ansicht()).gerichte.find((g: { name: string }) => g.name === 'Chili');
  expect(
    (await andere.patch(`/gerichte/${chili.id}`, { etag: chili.etag, personen: 20 })).ok()
  ).toBe(true);
  await hinweise
    .getByRole('button', { name: 'Vorschlag für Hackfleisch übernehmen: 1.000 g' })
    .click();
  await expect(page.getByText(/inzwischen auf 20 geändert/).first()).toBeVisible();
  await expect.poll(() => zeilenMenge(karte, 'Hackfleisch')).toBe('500 g');
  await expect(hinweise.getByText(/seit der Prüfung geändert/)).toBeVisible();
  await expect(
    hinweise.getByRole('button', { name: 'Vorschlag für Hackfleisch übernehmen: 1.000 g' })
  ).toHaveCount(0);
  await page.unroute('**/api/essensplanung/planung/stand?*');
  await hinweise.getByRole('button', { name: 'Gericht neu prüfen' }).click();
  await expect(hinweise.getByText('Die Menge wirkt für 20 Personen knapp.')).toBeVisible();
  await expect(hinweise.getByText(/seit der Prüfung geändert/)).toHaveCount(0);
});

test('maintenance keeps the recipe being read; taking over waits until it ends', async ({
  page,
}) => {
  await anlegen(page, 'E2E KI Wartung');
  const karte = await gericht(page, 'Suppe', '4');
  await karte.getByRole('button', { name: 'Rezept einfügen (KI)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rezept für Suppe' });
  await dialog.getByLabel('Rezept', { exact: true }).fill('500 g Zwiebeln');
  await dialog.getByRole('button', { name: 'Zutaten erkennen' }).click();
  await expect(dialog.getByLabel('Menge für 500 g Zwiebeln')).toHaveValue('500');

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
  await wartung(true);
  await expect(dialog.getByText(/wird gerade gewartet/)).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByLabel('Menge für 500 g Zwiebeln')).toHaveValue('500');
  await expect(dialog.getByRole('button', { name: 'Eine Zutat übernehmen' })).toBeDisabled();
  await wartung(false);
  await expect(dialog.getByRole('button', { name: 'Eine Zutat übernehmen' })).toBeEnabled({
    timeout: 15_000,
  });
  await page.unroute('**/api/essensplanung/planung/stand?*');
  await dialog.getByRole('button', { name: 'Eine Zutat übernehmen' }).click();
  await expect(page.getByText('Eine Zutat übernommen.').first()).toBeVisible();
  await expect.poll(() => zeilenMenge(karte, 'Zwiebeln')).toBe('500 g');
});
