// The Kurzbeschreibung for the KJR's grant: the sentence about the Aktion and its Zeitplan, kept
// with the other entries of the Abrechnung (`AbrechnungSession.kurzbeschreibung`).
import type { Kurzbeschreibung, ZeitBlock, ZeitplanTag } from '../../../api/lib/abrechnung-session';
import {
  MAX_ZEITBLOCK_TEXT,
  MAX_ZEITBLOECKE_PRO_TAG,
  MAX_ZEITPLAN_TAGE,
} from '../../../api/lib/abrechnung-session';
import type { PdfKurzbeschreibung } from './abrechnungPdf';
import { berlinDay } from './format';
import type { Vorstand } from './types';

export type { Kurzbeschreibung, ZeitBlock, ZeitplanTag };
export { MAX_ZEITBLOCK_TEXT, MAX_ZEITBLOECKE_PRO_TAG, MAX_ZEITPLAN_TAGE };

/** A block without its ID, as typed in or read from a file. */
export type NeuerBlock = Omit<ZeitBlock, 'id'>;

const WEEKDAY = new Intl.DateTimeFormat('de-DE', { weekday: 'long', timeZone: 'UTC' });
const DATE = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

const utc = (datum: string): Date => new Date(`${datum}T00:00:00Z`);

/** The day after `datum`, as `YYYY-MM-DD`. */
export function nextDay(datum: string): string {
  const date = utc(datum);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** All days of an Aktion from CampFlow's start and end; empty without dates. */
export function aktionTage(start: string | null, end: string | null): string[] {
  const first = berlinDay(start) ?? berlinDay(end);
  const last = berlinDay(end) ?? first;
  if (!first || !last) return [];
  const tage: string[] = [];
  for (let day = first; day <= last && tage.length < MAX_ZEITPLAN_TAGE; day = nextDay(day)) {
    tage.push(day);
  }
  return tage;
}

/** „Montag, 25.05.2026“ */
export function tagTitel(datum: string): string {
  const date = utc(datum);
  return `${WEEKDAY.format(date)}, ${DATE.format(date)}`;
}

/** „Mo“ for short labels such as „Auf Mo verschieben“. */
export function kurzerWochentag(datum: string): string {
  return WEEKDAY.format(utc(datum)).slice(0, 2);
}

/** The days as entered, or the empty days of the Aktion while nothing was entered yet. */
export function zeitplanTage(
  kurzbeschreibung: Kurzbeschreibung,
  start: string | null,
  end: string | null
): ZeitplanTag[] {
  return kurzbeschreibung.tage.length > 0
    ? kurzbeschreibung.tage
    : aktionTage(start, end).map((datum) => ({ datum, bloecke: [] }));
}

export function neueBlockId(): string {
  return (
    globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14)
  );
}

export function mitId(block: NeuerBlock): ZeitBlock {
  return { id: neueBlockId(), ...block };
}

/** `08:00` as „8:00“. */
function uhrzeit(value: string): string {
  return value.replace(/^0(\d)/, '$1');
}

/** „8:00–9:00“, „20:30“, „bis 10:00“ or empty. */
export function formatZeit(block: Pick<ZeitBlock, 'von' | 'bis'>): string {
  if (!block.von) return block.bis ? `bis ${uhrzeit(block.bis)}` : '';
  return block.bis ? `${uhrzeit(block.von)}–${uhrzeit(block.bis)}` : uhrzeit(block.von);
}

/** `8`, `8:15`, `8.15` or `815` as `08:00`/`08:15`; null if it is no time of day. */
export function parseUhrzeit(value: string): string | null {
  const match = /^(\d{1,2})(?:[:.,]?(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null;
  return `${String(hours % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const TIME = String.raw`(\d{1,2}(?:[:.,]\d{2})?)`;
const LINE = new RegExp(
  String.raw`^${TIME}(?!\d) *(?:uhr)? *(?:(?:[-–—]|bis|\t)\s*(?:${TIME}|…|\.\.\.)?\s*(?:uhr)?)?\s*[:|\t–-]?\s*(.*)$`,
  'i'
);

/**
 * Lines typed or pasted at once, one block each, e.g. „8-9 Uhr Frühstück“, „20.30 Lagerfeuer“,
 * „ganztags Hike“ or cells copied from a table („08:00⇥09:00⇥Frühstück“). A line without a time
 * becomes a block without one.
 */
export function parseZeitzeilen(text: string): NeuerBlock[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const match = LINE.exec(line);
      // „3 Teams“ is no time: a full hour needs „Uhr“, a range or a table cell after it
      const isTime =
        !!match &&
        (/[:.,]/.test(match[1]) ||
          match[2] !== undefined ||
          /^\d{1,2}\s*(uhr|[-–—\t]|bis\b)/i.test(line));
      const von = match && isTime ? parseUhrzeit(match[1]) : null;
      if (!match || von === null || !match[3]?.trim()) {
        return { von: '', bis: '', text: line.replace(/\t+/g, ' ').slice(0, MAX_ZEITBLOCK_TEXT) };
      }
      const bis = match[2] ? (parseUhrzeit(match[2]) ?? '') : '';
      return {
        von,
        bis,
        text: match[3].replace(/\t+/g, ' ').trim().slice(0, MAX_ZEITBLOCK_TEXT),
      };
    });
}

/** Blocks without a time first, then by start; blocks of the same time keep their order. */
export function nachUhrzeit(bloecke: ZeitBlock[]): ZeitBlock[] {
  return [...bloecke].sort((a, b) => a.von.localeCompare(b.von));
}

export function istNachUhrzeit(bloecke: ZeitBlock[]): boolean {
  return bloecke.every((block, index) => index === 0 || bloecke[index - 1].von <= block.von);
}

/** Where a new block after `bloecke` starts: where the last one ended, or empty. */
export function naechsterBeginn(bloecke: ZeitBlock[]): string {
  const last = bloecke.at(-1);
  return last?.bis || '';
}

/**
 * Days read from a file merged with the days of the Aktion: every day of the Aktion stays, days
 * of the file outside it are added, all sorted by date.
 */
export function mitAktionTagen(
  gelesen: { datum: string; bloecke: NeuerBlock[] }[],
  start: string | null,
  end: string | null
): ZeitplanTag[] {
  const tage = new Map<string, ZeitBlock[]>(aktionTage(start, end).map((datum) => [datum, []]));
  for (const tag of gelesen) {
    tage.set(tag.datum, [...(tage.get(tag.datum) ?? []), ...tag.bloecke.map(mitId)]);
  }
  return [...tage.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_ZEITPLAN_TAGE)
    .map(([datum, bloecke]) => ({ datum, bloecke: bloecke.slice(0, MAX_ZEITBLOECKE_PRO_TAG) }));
}

export function kurzbeschreibungPdfData(
  aktion: string,
  zeitraum: string,
  kurzbeschreibung: Kurzbeschreibung,
  tage: ZeitplanTag[],
  vorstaende: Vorstand[]
): PdfKurzbeschreibung {
  return {
    aktion,
    zeitraum,
    einleitung: kurzbeschreibung.einleitung,
    tage: tage
      .map((tag) => ({
        titel: tagTitel(tag.datum),
        bloecke: tag.bloecke
          .filter((block) => block.text.trim() !== '' || block.von !== '' || block.bis !== '')
          .map((block) => ({ zeit: formatZeit(block), text: block.text.trim() })),
      }))
      .filter((tag) => tag.bloecke.length > 0),
    vorstaende,
  };
}
