/**
 * What new minutes start with, taken from other modules (#264): the Gruppenstunden of the
 * Anwesenheit in the Stufenberichte, the Aktionen of the calendar in Reflexion and Planung, and
 * time and place of the next meeting from the previous minutes. Only data every leader may see
 * is copied: counts and the text of a Gruppenstunde (never names of children or guests) and
 * Aktionen of the public calendar (not those only for Leitende). Each source fails alone; the
 * writer can change every text.
 */
import { getMeetingSummaries } from './anwesenheit';
import { getAktionen, isLeitendeOnly } from './aktionen-list';
import type { Aktion } from './aktionen-list';
import { getDb, toDateString } from './db';
import { aktionZeitraum, einzeilig, MAX_TEXT } from './protokoll-editor-model';
import type { Vorbelegung } from './protokoll-editor-model';

/** Longest period an entry reaches back or ahead when there are no earlier minutes. */
export const VORBELEGUNG_RUECK_TAGE = 60;
export const VORBELEGUNG_VOR_TAGE = 90;
const MAX_AKTIONEN = 15;
/** Longest note of one Gruppenstunde in a Stufenbericht. */
const MAX_BERICHT_NOTIZ = 500;
const MAX_ORT = 200;

/** A Gruppenstunde as the Stufenbericht uses it: only counts and the text, never a name. */
export interface BerichtGruppenstunde {
  stufe: string;
  date: string;
  members: number;
  excused: number;
  guests: number;
  notes: string;
  cancelled: boolean;
}

/** „3“ → „3 Kinder“, „1“ → „ein Kind“. */
function kinder(count: number): string {
  return count === 1 ? 'ein Kind' : `${count} Kinder`;
}

/**
 * The Stufenberichte: for each Stufe a list of its Gruppenstunden (oldest first) with the number
 * of children and what the group did. A Stufe without a Gruppenstunde has no entry.
 */
export function stufenberichte(meetings: BerichtGruppenstunde[]): Record<string, string> {
  const berichte: Record<string, string> = {};
  const sorted = [...meetings].sort((a, b) => a.date.localeCompare(b.date));
  for (const meeting of sorted) {
    const [, month, day] = meeting.date.split('-');
    let line = `- ${day}.${month}.: `;
    if (meeting.cancelled) {
      line += 'fiel aus';
    } else {
      const extras = [
        meeting.excused > 0 ? `${meeting.excused} entschuldigt` : '',
        meeting.guests > 0 ? (meeting.guests === 1 ? 'ein Gast' : `${meeting.guests} Gäste`) : '',
      ].filter(Boolean);
      line += kinder(meeting.members) + (extras.length ? ` (${extras.join(', ')})` : '');
      const notes = einzeilig(meeting.notes, MAX_BERICHT_NOTIZ);
      if (notes) line += `. ${notes}`;
    }
    berichte[meeting.stufe] = `${berichte[meeting.stufe] ?? ''}${line}\n`;
  }
  for (const [stufe, text] of Object.entries(berichte)) {
    berichte[stufe] = text.trimEnd().slice(0, MAX_TEXT);
  }
  return berichte;
}

/** The last day of an Aktion (its start if it has no end). */
function aktionEnde(aktion: Aktion): string {
  return aktion.end || aktion.start;
}

function aktionZeile(aktion: Aktion): string {
  const zeitraum = aktionZeitraum({
    id: aktion.id,
    titel: aktion.title,
    start: aktion.start,
    ende: aktion.end,
  });
  const stufen = aktion.stufen.length ? ` (${aktion.stufen.join(', ')})` : '';
  return `- ${zeitraum ? `${zeitraum}: ` : ''}${einzeilig(aktion.title)}${stufen}`;
}

/**
 * Aktionen of the public calendar for Reflexion (ended after `nach` up to `date`) and Planung
 * (still running or starting after `date`, until `bis`), each as a short list with a heading.
 * Entries only for Leitende are left out.
 */
export function aktionenTexte(
  aktionen: Aktion[],
  { nach, date, bis }: { nach: string; date: string; bis: string }
): Record<string, string> {
  const offen = aktionen.filter((aktion) => aktion.start && !isLeitendeOnly(aktion));
  const liste = (heading: string, treffer: Aktion[]): string =>
    treffer.length === 0
      ? ''
      : [heading, ...treffer.slice(0, MAX_AKTIONEN).map(aktionZeile)].join('\n');
  const byStart = (a: Aktion, b: Aktion): number => a.start.localeCompare(b.start);
  const texte: Record<string, string> = {};
  const rueckblick = liste(
    'Aktionen seit der letzten Sitzung:',
    offen.filter((a) => aktionEnde(a) > nach && aktionEnde(a) <= date).sort(byStart)
  );
  const planung = liste(
    'Anstehende Aktionen:',
    offen.filter((a) => aktionEnde(a) > date && a.start <= bis).sort(byStart)
  );
  if (rueckblick) texte['Reflexion'] = rueckblick;
  if (planung) texte['Planung'] = planung;
  return texte;
}

/** Time and place of the next meeting as the previous minutes planned them; empty if unreadable. */
export function naechsteSitzungAus(content: string): Vorbelegung['naechsteSitzung'] {
  try {
    const next = (JSON.parse(content) as { naechsteSitzung?: Record<string, unknown> })
      .naechsteSitzung;
    const uhrzeit = typeof next?.uhrzeit === 'string' && /^\d\d:\d\d$/.test(next.uhrzeit);
    return {
      uhrzeit: uhrzeit ? (next?.uhrzeit as string) : '',
      ort: typeof next?.ort === 'string' ? einzeilig(next.ort, MAX_ORT) : '',
    };
  } catch {
    return { uhrzeit: '', ort: '' };
  }
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/**
 * The periods the sources reach back and ahead of the meeting on `date`. Gruppenstunden go back
 * to the previous minutes but at most `VORBELEGUNG_RUECK_TAGE`; Aktionen go back to the previous
 * minutes however long ago they were (the limit only applies without previous minutes), so a
 * camp in between is not forgotten.
 */
export function zeitfenster(
  date: string,
  vorherDate: string | undefined
): { gruppenstunden: string; aktionen: string; bis: string } {
  const fruehestens = addDays(date, -VORBELEGUNG_RUECK_TAGE);
  return {
    gruppenstunden: vorherDate && vorherDate > fruehestens ? vorherDate : fruehestens,
    aktionen: vorherDate ?? fruehestens,
    bis: addDays(date, VORBELEGUNG_VOR_TAGE),
  };
}

/** The minutes with the latest meeting before `date`. */
async function previousMinutes(
  date: string
): Promise<{ date: string; content: string } | undefined> {
  const row = await getDb()
    .selectFrom('protokoll.protokoll')
    .select(['meeting_date', 'content'])
    .where('meeting_date', '<', date)
    .orderBy('meeting_date', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  return row ? { date: toDateString(row.meeting_date), content: row.content } : undefined;
}

/** What new minutes for the meeting on `date` start with; a failing source adds nothing. */
export async function vorbelegungFuer(date: string): Promise<Vorbelegung> {
  const vorher = await previousMinutes(date).catch(() => undefined);
  const fenster = zeitfenster(date, vorher?.date);
  const [gruppenstunden, aktionen] = await Promise.allSettled([
    getMeetingSummaries({ from: fenster.gruppenstunden, to: date }),
    getAktionen(),
  ]);
  const texte: Record<string, string> = {
    ...(aktionen.status === 'fulfilled'
      ? aktionenTexte(aktionen.value, {
          nach: fenster.aktionen,
          date,
          bis: fenster.bis,
        })
      : {}),
    ...(gruppenstunden.status === 'fulfilled'
      ? stufenberichte(
          gruppenstunden.value.filter((meeting) => meeting.date > fenster.gruppenstunden)
        )
      : {}),
  };
  return {
    texte,
    naechsteSitzung: vorher ? naechsteSitzungAus(vorher.content) : { uhrzeit: '', ort: '' },
  };
}
