import { fetchApi, fetchFile, sendApi } from './api';
import type { EssenKatalog, PlanungAenderung, PlanungAnsicht } from './types';

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
    katalog: (signal?: AbortSignal) =>
      fetchApi<EssenKatalog>('/essensplanung/planung/katalog', signal, headers),
    senden: <T = PlanungAnsicht>(
      method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      path: string,
      body?: unknown,
      etag?: string
    ) => sendApi<T>(method, `/essensplanung/planung${path}`, body, { headers, etag }),
    /** A picture of a receipt (`vorschau`, `bild`, `original`) or its file (`datei`). */
    belegFoto: (
      id: number,
      art: 'vorschau' | 'bild' | 'original' | 'datei',
      signal?: AbortSignal
    ) => fetchFile(`/essensplanung/planung/belege/${id}/foto?art=${art}`, signal, headers),
    /** Where a new photo of a receipt is checked, for `createBelegPhotoDraft`. */
    belegPruefung: { url: '/essensplanung/planung/belege/pruefung', headers },
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
  'gericht-neu': 'hat ein Gericht angelegt',
  'gericht-geaendert': 'hat ein Gericht geändert',
  'gericht-geloescht': 'hat ein Gericht gelöscht',
  'gericht-zutat-neu': 'hat eine Zutat hinzugefügt',
  'gericht-zutat-geaendert': 'hat eine Zutat geändert',
  'gericht-zutat-geloescht': 'hat eine Zutat entfernt',
  'zutat-neu': 'hat eine eigene Zutat angelegt',
  'zutat-geaendert': 'hat eine Zutat der Planung geändert',
  'zutat-geloescht': 'hat eine Zutat der Planung gelöscht',
  'einplanung-neu': 'hat ein Gericht eingeplant',
  'einplanung-geaendert': 'hat eine Einplanung geändert',
  'einplanung-geloescht': 'hat ein Gericht aus einer Mahlzeit genommen',
  'einplanung-abgehakt': 'hat ein Gericht abgehakt',
  'gruppe-neu': 'hat eine Gruppe angelegt',
  'gruppe-geaendert': 'hat eine Gruppe geändert',
  'gruppe-geloescht': 'hat eine Gruppe gelöscht',
  'teilnehmende-neu': 'hat Teilnehmende hinzugefügt',
  'teilnehmende-geaendert': 'hat Teilnehmende geändert',
  'teilnehmende-geloescht': 'hat Teilnehmende entfernt',
  'geschaeft-neu': 'hat ein Geschäft angelegt',
  'geschaeft-geaendert': 'hat ein Geschäft geändert',
  'geschaeft-geloescht': 'hat ein Geschäft gelöscht',
  'zutat-geschaeft': 'hat ein Geschäft gewählt',
  'bestand-neu': 'hat Bestand eingetragen',
  'bestand-geaendert': 'hat Bestand geändert',
  'bestand-geloescht': 'hat Bestand entfernt',
  'zusatzbedarf-neu': 'hat Zusatzbedarf eingetragen',
  'zusatzbedarf-geaendert': 'hat Zusatzbedarf geändert',
  'zusatzbedarf-geloescht': 'hat Zusatzbedarf entfernt',
  'einkauf-neu': 'hat einen Einkauf angelegt',
  'einkauf-geaendert': 'hat einen Einkauf geändert',
  'einkauf-geloescht': 'hat einen Einkauf gelöscht',
  'einkauf-abgehakt': 'hat beim Einkaufen abgehakt',
  'einkauf-aufgehoben': 'hat ein Häkchen beim Einkaufen aufgehoben',
  'einkauf-regel': 'hat einen Posten eines Einkaufs angepasst',
  'einkauf-verschoben': 'hat einen Posten in einen anderen Einkauf verschoben',
  'einkauf-zurueckgeholt': 'hat einen Posten in einen Einkauf zurückgeholt',
  'packliste-neu': 'hat etwas auf die Packliste gesetzt',
  'packliste-geaendert': 'hat die Packliste geändert',
  'packliste-geloescht': 'hat etwas von der Packliste genommen',
  'beleg-neu': 'hat einen Beleg eingetragen',
  'beleg-geaendert': 'hat einen Beleg geändert',
  'beleg-foto': 'hat das Foto eines Belegs geändert',
  'beleg-geloescht': 'hat einen Beleg gelöscht',
};

/** What a change of the packing list did: packed, unpacked, or who packs it. */
function packText(details: Record<string, unknown>): string {
  if (details.gepackt === true) return 'hat eingepackt';
  if (details.gepackt === false) return 'hat wieder ausgepackt';
  if (details.zustaendig === '') return 'hat eine Zuständigkeit entfernt';
  if (typeof details.zustaendig === 'string') return `hat ${details.zustaendig} zuständig gemacht`;
  return AENDERUNGEN['packliste-geaendert'];
}

/** What ticking off a planned dish did, by its new status. */
const ABGEHAKT: Record<string, string> = {
  gekocht: 'hat ein Gericht als gekocht abgehakt',
  ausgelassen: 'hat ein Gericht als ausgelassen abgehakt',
  offen: 'hat ein Gericht wieder offen gesetzt',
};

/** „Kim hat eine Mahlzeit geändert: Brunch (1.8.)“. */
export function aenderungText(aenderung: PlanungAenderung): string {
  const wer = aenderung.wer || 'Jemand';
  if (aenderung.aktion === 'gericht-zutaten-neu')
    return zutatenHinzugefuegt(wer, aenderung.details);
  const {
    name,
    datum,
    gericht,
    mahlzeit,
    verschoben,
    anzahl,
    gruppe,
    isst,
    geschaeft,
    status,
    einkauf,
    abgeschlossen,
  } = aenderung.details;
  const gruppen = aenderung.aktion === 'mahlzeit-gruppen';
  const laden = aenderung.aktion === 'zutat-geschaeft';
  const was = gruppen
    ? isst === true
      ? 'lässt eine Gruppe mitessen'
      : 'nimmt eine Gruppe aus einer Mahlzeit'
    : laden && geschaeft === null
      ? 'hat ein Geschäft entfernt'
      : aenderung.aktion === 'packliste-geaendert'
        ? packText(aenderung.details)
        : verschoben === true
          ? 'hat ein Gericht verschoben'
          : aenderung.aktion === 'einplanung-abgehakt' && typeof status === 'string'
            ? (ABGEHAKT[status] ?? AENDERUNGEN[aenderung.aktion])
            : aenderung.aktion === 'einkauf-geaendert' && typeof abgeschlossen === 'boolean'
              ? abgeschlossen
                ? 'hat einen Einkauf abgeschlossen'
                : 'hat einen Einkauf wieder geöffnet'
              : aenderung.aktion === 'beleg-geaendert' &&
                  typeof aenderung.details.erstattet === 'boolean'
                ? aenderung.details.erstattet
                  ? 'hat einen Beleg als erstattet markiert'
                  : 'hat „erstattet“ bei einem Beleg aufgehoben'
                : (AENDERUNGEN[aenderung.aktion] ?? 'hat etwas geändert');
  const ziel = [
    gruppen && typeof gruppe === 'string' ? `${gruppe} bei` : '',
    typeof anzahl === 'number' ? String(anzahl) : '',
    typeof name === 'string' ? name : '',
    laden && typeof geschaeft === 'string' ? `bei ${geschaeft}` : '',
    typeof mahlzeit === 'string' ? `bei ${mahlzeit}` : '',
    typeof datum === 'string' ? `(${datumKurz(datum)})` : '',
    typeof gericht === 'string' ? `in „${gericht}“` : '',
    typeof einkauf === 'string' ? `in „${einkauf}“` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return ziel && aenderung.aktion !== 'mitglied-beigetreten'
    ? `${wer} ${was}: ${ziel}`
    : `${wer} ${was}`;
}

/** „Kim hat 3 Zutaten in „Chili“ hinzugefügt: Zwiebeln, Hackfleisch, Salz“ (names up to five). */
function zutatenHinzugefuegt(wer: string, details: Record<string, unknown>): string {
  const anzahl = typeof details.anzahl === 'number' ? details.anzahl : 0;
  const gericht = typeof details.gericht === 'string' ? ` in „${details.gericht}“` : '';
  const namen = Array.isArray(details.namen)
    ? details.namen.filter((name): name is string => typeof name === 'string')
    : [];
  const was = anzahl === 1 ? 'eine Zutat' : anzahl > 1 ? `${anzahl} Zutaten` : 'Zutaten';
  const liste = namen.length && anzahl <= 5 ? `: ${namen.join(', ')}` : '';
  return `${wer} hat ${was}${gericht} hinzugefügt${liste}`;
}
