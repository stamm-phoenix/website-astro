import type { APIRequestContext, APIResponse, Locator, Page } from '@playwright/test';
import { expect } from './fixtures';

/**
 * Prepares a Planung over the demo API instead of the pages, for tests whose subject comes after
 * the preparation (conflicts, drafts, late answers). Creating a Planung, dishes, participants and
 * trips over the pages is tested in the other `essensplanung-*` specs; the bodies here are the
 * ones those pages send.
 */

interface Mahlzeit {
  id: number;
  kennung: string;
}

interface Ansicht {
  tage: { mahlzeiten: Mahlzeit[] }[];
  gruppen: { id: number; name: string }[];
}

/** A dish to prepare: its lines are ingredients of the central list, amounts in `einheit`. */
export interface GerichtVorlage {
  name: string;
  personen?: number;
  zutaten?: { name: string; menge: number; einheit: string }[];
  /** Meals (`1_2`) the dish is planned at. */
  mahlzeiten?: string[];
}

export interface Vorbereitung {
  gerichte?: GerichtVorlage[];
  /** Participants by group name, eating everything at all meals. */
  teilnehmende?: { gruppe: string; anzahl: number }[];
  /** Things added under „Noch etwas besorgen“. */
  zusatz?: string[];
  /** Trips for all shops and all meals. */
  einkaeufe?: string[];
  /** The tab opened at the end. */
  tab?: string;
}

async function gelesen<T>(antwort: APIResponse, was: string): Promise<T> {
  expect(antwort.ok(), `${was}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return (await antwort.json()) as T;
}

/** Calls the API of a Planung with its link, as the page does. */
function planungApi(request: APIRequestContext, token: string) {
  const headers = { 'x-essensplanung-token': token };
  const base = '/api/essensplanung/planung';
  return {
    get: async <T>(pfad: string): Promise<T> =>
      gelesen<T>(await request.get(`${base}${pfad}`, { headers }), pfad),
    post: async <T>(pfad: string, data: unknown): Promise<T> =>
      gelesen<T>(await request.post(`${base}${pfad}`, { headers, data }), pfad),
  };
}

/**
 * Creates the Planung `name` (1 to 2 August 2027, by Kim Küche) and fills it with
 * `vorbereitung`; returns the token of its link.
 */
export async function planungAnlegen(
  request: APIRequestContext,
  name: string,
  vorbereitung: Vorbereitung = {}
): Promise<string> {
  const { vorschauLink } = await gelesen<{ vorschauLink: string }>(
    await request.post('/api/essensplanung/anlegen', {
      data: {
        email: 'kim@stamm-phoenix.de',
        name: 'Kim Küche',
        planungName: name,
        ersterTag: '2027-08-01',
        letzterTag: '2027-08-02',
        altcha: 'e2e',
      },
    }),
    'anlegen'
  );
  const { token } = await gelesen<{ token: string }>(
    await request.post('/api/essensplanung/anlegen/bestaetigen', {
      data: { token: new URLSearchParams(new URL(vorschauLink).hash.slice(1)).get('a') },
    }),
    'bestaetigen'
  );
  const api = planungApi(request, token);
  const ansicht = await api.get<Ansicht>('');
  const mahlzeit = (kennung: string): Mahlzeit => {
    const treffer = ansicht.tage.flatMap((t) => t.mahlzeiten).find((m) => m.kennung === kennung);
    if (!treffer) throw new Error(`No meal ${kennung}`);
    return treffer;
  };
  const katalog = (await api.get<{ zutaten: { id: number; name: string }[] }>('/katalog')).zutaten;
  const zutatId = (zutat: string): number | undefined => katalog.find((z) => z.name === zutat)?.id;

  for (const gericht of vorbereitung.gerichte ?? []) {
    const { id } = await api.post<{ id: number }>('/gerichte', {
      name: gericht.name,
      personen: gericht.personen ?? null,
    });
    for (const zeile of gericht.zutaten ?? []) {
      const zeileZutat = zutatId(zeile.name);
      if (zeileZutat === undefined) throw new Error(`No ingredient ${zeile.name} in the list`);
      await api.post(`/gerichte/${id}/zutaten`, {
        zutatId: zeileZutat,
        menge: zeile.menge,
        einheit: zeile.einheit,
        fest: false,
        fuerAlles: true,
        fuerVegetarisch: true,
        fuerVegan: true,
        ohne: [],
        nur: [],
        hinweis: '',
      });
    }
    for (const kennung of gericht.mahlzeiten ?? [])
      await api.post('/einplanungen', {
        mahlzeitId: mahlzeit(kennung).id,
        gerichtId: id,
        faktor: 1,
        zustaendigId: null,
        zustaendigText: '',
      });
  }
  for (const { gruppe, anzahl } of vorbereitung.teilnehmende ?? []) {
    const gruppeId = ansicht.gruppen.find((g) => g.name === gruppe)?.id;
    if (gruppeId === undefined) throw new Error(`No group ${gruppe}`);
    await api.post('/teilnehmende', {
      gruppeId,
      ernaehrung: 'alles',
      anzahl,
      unvertraeglichkeiten: [],
      vonMahlzeitId: null,
      bisMahlzeitId: null,
      hinweis: '',
    });
  }
  for (const zusatz of vorbereitung.zusatz ?? []) {
    const id = zutatId(zusatz);
    await api.post('/zusatzbedarf', {
      ...(id === undefined ? { name: zusatz } : { zutatId: id }),
      menge: null,
      einheit: null,
      hinweis: '',
    });
  }
  for (const einkauf of vorbereitung.einkaeufe ?? [])
    await api.post('/einkaeufe', {
      name: einkauf,
      datum: null,
      geschaeftId: null,
      bisMahlzeitId: null,
      abgeschlossen: false,
    });
  return token;
}

/**
 * Creates the Planung `name` like `planungAnlegen` and opens it on its page, with the tab
 * `vorbereitung.tab`.
 */
export async function planungVorbereiten(
  page: Page,
  name: string,
  vorbereitung: Vorbereitung = {}
): Promise<void> {
  const token = await planungAnlegen(page.request, name, vorbereitung);
  await page.goto(`/essensplanung/planung#${new URLSearchParams({ t: token })}`);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  if (vorbereitung.tab) await page.getByRole('tab', { name: vorbereitung.tab }).click();
}

/** Pasta for 4 with 500 g of spaghetti, planned at the meals `mahlzeiten` (`1_2`). */
export function nudeln(mahlzeiten: string[]): GerichtVorlage {
  return {
    name: 'Nudeln',
    personen: 4,
    zutaten: [{ name: 'Nudeln (Spaghetti)', menge: 500, einheit: 'g' }],
    mahlzeiten,
  };
}

/**
 * Pasta for 4 (500 g), eaten by 8 Pfadis at lunch on both days: 1 kg each; opens the tab
 * „Einkauf“. The same Planung as `nudelnPlanen` (`essensplanung-einkaeufe-helpers.ts`).
 */
export function nudelnVorbereiten(
  page: Page,
  name: string,
  extra: Pick<Vorbereitung, 'zusatz' | 'einkaeufe'> = {}
): Promise<void> {
  return planungVorbereiten(page, name, {
    gerichte: [nudeln(['1_2', '2_2'])],
    teilnehmende: [{ gruppe: 'Pfadi', anzahl: 8 }],
    ...extra,
    tab: 'Einkauf',
  });
}

/** Unfolds a dish on the tab „Gerichte“, as a new one is unfolded after creating it. */
export async function gerichtOeffnen(page: Page, name: string): Promise<Locator> {
  const karte = page.locator('li', { has: page.getByText(name, { exact: true }) }).first();
  await karte.getByText(name, { exact: true }).click();
  await expect(karte.locator('details')).toHaveAttribute('open', '');
  return karte;
}
