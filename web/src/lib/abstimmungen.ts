import { createResource } from './pflegeStore.svelte';
import type {
  AbstimmungDetail,
  AbstimmungErgebnis,
  AbstimmungSichtbarkeit,
  AbstimmungUebersicht,
} from '../../../api/lib/abstimmung-model';
export type {
  AbstimmungAnsicht,
  AbstimmungDetail,
  AbstimmungEinsicht,
  AbstimmungErgebnis,
  AbstimmungOption,
  AbstimmungSichtbarkeit,
  AbstimmungTeilnahme,
  AbstimmungUebersicht,
} from '../../../api/lib/abstimmung-model';
export { MAX_ABSTIMMUNG_OPTIONEN, maxAuswahlText } from '../../../api/lib/abstimmung-model';

/** An answer on a page: the options chosen with „Ja“ (`gewaehlt`) and with „Vielleicht“. */
export interface AbstimmungWahl {
  gewaehlt: number[];
  vielleicht: number[];
}

/** The answer of `ich`, or an empty one. */
export function wahlVon(ich: AbstimmungWahl | null | undefined): AbstimmungWahl {
  return { gewaehlt: [...(ich?.gewaehlt ?? [])], vielleicht: [...(ich?.vielleicht ?? [])] };
}

/** The answer without options that are gone. */
export function wahlOhne(wahl: AbstimmungWahl, optionen: ReadonlySet<number>): AbstimmungWahl {
  return {
    gewaehlt: wahl.gewaehlt.filter((id) => optionen.has(id)),
    vielleicht: wahl.vielleicht.filter((id) => optionen.has(id)),
  };
}

/**
 * A kept answer read back, without options that are gone: an object, or the plain list of IDs
 * kept before „Vielleicht“ existed.
 */
export function wahlAusText(text: string, optionen: ReadonlySet<number>): AbstimmungWahl | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const ids = (list: unknown): number[] =>
    Array.isArray(list) ? list.filter((id): id is number => typeof id === 'number') : [];
  if (Array.isArray(value)) return wahlOhne({ gewaehlt: ids(value), vielleicht: [] }, optionen);
  if (!value || typeof value !== 'object') return null;
  const { gewaehlt, vielleicht } = value as Record<string, unknown>;
  return wahlOhne({ gewaehlt: ids(gewaehlt), vielleicht: ids(vielleicht) }, optionen);
}

/** Who sees who chose what, as the form offers it. */
export const SICHTBARKEIT_LABELS: Record<AbstimmungSichtbarkeit, string> = {
  offen: 'Alle, die abstimmen, sehen, wer was gewählt hat',
  anonym:
    'Nur ich sehe, wer was gewählt hat. Die anderen sehen, wer abgestimmt hat, und die Stimmen je Option',
  geheim: 'Nur ich sehe, wer abgestimmt hat und was. Die anderen sehen nur die Stimmen je Option',
};

/** A note on the result when not everyone sees who chose what; `null` when they do. */
export function sichtbarkeitHinweis(ergebnis: AbstimmungErgebnis, eigene: boolean): string | null {
  if (ergebnis.sichtbarkeit === 'offen') return null;
  if (eigene) {
    return ergebnis.sichtbarkeit === 'anonym'
      ? 'Nur du siehst, wer was gewählt hat. Die anderen sehen, wer abgestimmt hat.'
      : 'Nur du siehst, wer abgestimmt hat und was.';
  }
  return ergebnis.sichtbarkeit === 'anonym'
    ? `Was die anderen gewählt haben, sieht nur ${ergebnis.erstelltVonName}.`
    : `Wer abgestimmt hat und was, sieht nur ${ergebnis.erstelltVonName}.`;
}

/** Path of the detail page in the Leitendenbereich. */
export function abstimmungHref(id: number): string {
  return `/leitendenbereich/abstimmungen/abstimmung?id=${id}`;
}

export const abstimmungenStore = createResource<AbstimmungUebersicht[]>(
  '/intern/pflege/abstimmungen'
);

export const abstimmungStore = createResource<AbstimmungDetail, number>(
  (id) => `/intern/pflege/abstimmungen/${id}`,
  { idle: true }
);

/** What the public page opens: the shared link (`link`) or a personal one (`token`). */
export interface AbstimmungLink {
  link?: string;
  token?: string;
}

/** Reads `#link=…` or `#t=…`; the token stays in the fragment, which is never sent to a server. */
export function parseAbstimmungHash(hash: string): AbstimmungLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get('t');
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) return { token };
  const link = params.get('link');
  if (link && /^[A-Za-z0-9_-]{43}$/.test(link)) return { link };
  return null;
}

const WEEKDAY = new Intl.DateTimeFormat('de-DE', { weekday: 'short', timeZone: 'UTC' });

/**
 * A date (and time) as the text of an option, e.g. „Sa, 14.11.2026, 18:00 Uhr“. The option stays
 * plain text, so dates and other answers can be mixed and changed freely.
 */
export function terminText(date: string, time = ''): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return '';
  const [, year, month, day] = match;
  const weekday = WEEKDAY.format(new Date(Date.UTC(+year, +month - 1, +day))).replace('.', '');
  const clock = /^\d{2}:\d{2}$/.test(time) ? `, ${time} Uhr` : '';
  return `${weekday}, ${day}.${month}.${year}${clock}`;
}

/** IDs of the options with the most votes; none while nobody chose anything. */
export function spitzenreiter(ergebnis: Pick<AbstimmungErgebnis, 'optionen'>): Set<number> {
  const most = Math.max(0, ...ergebnis.optionen.map((option) => option.stimmen));
  if (most === 0) return new Set();
  return new Set(ergebnis.optionen.filter((o) => o.stimmen === most).map((o) => o.id));
}

/** „1 Antwort“, „3 Antworten“. */
export function antwortenText(count: number): string {
  return count === 1 ? '1 Antwort' : `${count} Antworten`;
}

/** „1 Stimme“, „3 Stimmen“. */
export function stimmenText(count: number): string {
  return count === 1 ? '1 Stimme' : `${count} Stimmen`;
}
