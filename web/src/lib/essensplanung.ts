import { fetchApi, sendApi } from './api';
import type { PlanungAenderung, PlanungAnsicht } from './types';

/**
 * Pages of the Essensplanung (`docs/essensplanung.md`): no login, the link of a Planung carries a
 * token in its fragment (`#t=…`), which every request sends in a header.
 */

export const TOKEN_HEADER = 'x-essensplanung-token';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The token of a fragment like `#t=…`, if it looks like one. */
export function tokenAusHash(hash: string, param: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get(param);
  return value && TOKEN.test(value) ? value : null;
}

export function planungUrl(token: string, origin = window.location.origin): string {
  return `${origin}/essensplanung/planung#${new URLSearchParams({ t: token })}`;
}

export function beitrittUrl(token: string, origin = window.location.origin): string {
  return `${origin}/essensplanung/beitreten#${new URLSearchParams({ b: token })}`;
}

/** Requests of a Planung with the token of its link. */
export function planungApi(token: string) {
  const headers = { [TOKEN_HEADER]: token };
  return {
    laden: (signal?: AbortSignal) =>
      fetchApi<PlanungAnsicht>('/essensplanung/planung', signal, headers),
    stand: (stand: string, signal?: AbortSignal) =>
      fetchApi<{ stand: string; ansicht?: PlanungAnsicht }>(
        `/essensplanung/planung/stand?seit=${encodeURIComponent(stand)}`,
        signal,
        headers
      ),
    senden: <T = PlanungAnsicht>(
      method: 'POST' | 'PATCH' | 'DELETE',
      path: string,
      body?: unknown,
      etag?: string
    ) => sendApi<T>(method, `/essensplanung/planung${path}`, body, { headers, etag }),
  };
}

// ---------------------------------------------------------------------------------------------
// Planungen opened on this device
// ---------------------------------------------------------------------------------------------

const ZULETZT_KEY = 'phoenix:essensplanung:zuletzt:v1';

export interface ZuletztGeoeffnet {
  token: string;
  name: string;
  zugang: PlanungAnsicht['zugang'];
  /** Epoch milliseconds. */
  geoeffnet: number;
}

/** Planungen opened on this device, newest first; a convenience, never the only way back. */
export function zuletztGeoeffnet(): ZuletztGeoeffnet[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ZULETZT_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is ZuletztGeoeffnet =>
            typeof entry?.token === 'string' &&
            TOKEN.test(entry.token) &&
            typeof entry.name === 'string' &&
            typeof entry.geoeffnet === 'number'
        )
      : [];
  } catch {
    return [];
  }
}

export function merkeGeoeffnet(
  token: string,
  name: string,
  zugang: PlanungAnsicht['zugang']
): void {
  try {
    const rest = zuletztGeoeffnet().filter((entry) => entry.token !== token);
    localStorage.setItem(
      ZULETZT_KEY,
      JSON.stringify([{ token, name, zugang, geoeffnet: Date.now() }, ...rest].slice(0, 10))
    );
  } catch {
    // Storage may be blocked; the list is only a convenience
  }
}

export function vergiss(token: string): void {
  try {
    localStorage.setItem(
      ZULETZT_KEY,
      JSON.stringify(zuletztGeoeffnet().filter((entry) => entry.token !== token))
    );
  } catch {
    // See above
  }
}

// ---------------------------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------------------------

const WOCHENTAG = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const LANG = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** „Sa., 1.8.2027“. */
export function datumKurz(datum: string): string {
  return WOCHENTAG.format(new Date(`${datum}T00:00:00Z`));
}

/** „1. August 2027“. */
export function datumLang(datum: string): string {
  return LANG.format(new Date(`${datum}T00:00:00Z`));
}

const AENDERUNGEN: Record<string, string> = {
  'planung-angelegt': 'hat die Planung angelegt',
  'planung-geaendert': 'hat die Einstellungen geändert',
  'tag-neu': 'hat einen Tag hinzugefügt',
  'tag-geaendert': 'hat einen Tag verschoben',
  'tag-geloescht': 'hat einen Tag gelöscht',
  'mahlzeit-neu': 'hat eine Mahlzeit hinzugefügt',
  'mahlzeit-geaendert': 'hat eine Mahlzeit geändert',
  'mahlzeit-geloescht': 'hat eine Mahlzeit gelöscht',
  'mitglied-eingeladen': 'hat jemanden eingeladen',
  'mitglied-beigetreten': 'ist beigetreten',
  'mitglied-geaendert': 'hat eine Rolle geändert',
  'mitglied-entzogen': 'hat einen Zugang entzogen',
  'mitglied-link': 'hat einen neuen Link verschickt',
  'link-beitritt': 'hat den Link zum Beitreten geändert',
  'link-lesen': 'hat den Link zum Ansehen geändert',
  'name-geaendert': 'hat den eigenen Namen geändert',
};

/** „Kim hat eine Mahlzeit geändert: Brunch (1.8.)“. */
export function aenderungText(aenderung: PlanungAenderung): string {
  const wer = aenderung.wer || 'Jemand';
  const was = AENDERUNGEN[aenderung.aktion] ?? 'hat etwas geändert';
  const { name, datum } = aenderung.details;
  const ziel = [
    typeof name === 'string' ? name : '',
    typeof datum === 'string' ? `(${datumKurz(datum)})` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return ziel && aenderung.aktion !== 'mitglied-beigetreten'
    ? `${wer} ${was}: ${ziel}`
    : `${wer} ${was}`;
}
