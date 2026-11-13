import type { ProtokollAufgabe, ProtokollPerson, ProtokollZeitraum, PunktTermin } from './types';

/**
 * The lines of the Markdown document (#613) that are no text: „Aufgabe:“, „Termin:“ and
 * „Zeitraum:“ with their fields, written and read back. Free of Svelte, so it is unit-tested.
 */

/** Keywords that start a line of their own; in a text they are escaped (`Aufgabe\:`). */
export const SCHLUESSEL = ['Aufgabe', 'Termin', 'Zeitraum'] as const;
export type Schluessel = (typeof SCHLUESSEL)[number];

const SCHLUESSEL_ZEILE = /^ {0,3}(aufgabe|termin|zeitraum)[ \t]*:/i;
const SCHLUESSEL_ESCAPED = /^( {0,3}(?:aufgabe|termin|zeitraum)[ \t]*)\\:/i;

/** The keyword a line starts with, or `null` for a line of text. */
export function schluesselOf(line: string): Schluessel | null {
  const match = SCHLUESSEL_ZEILE.exec(line);
  if (!match) return null;
  const word = match[1].toLowerCase();
  return SCHLUESSEL.find((s) => s.toLowerCase() === word) ?? null;
}

/** A line of text that would read as a keyword line gets a backslash: „Aufgabe\: …“. */
export function escapeSchluessel(line: string): string {
  return schluesselOf(line) ? line.replace(/:/, '\\:') : line;
}

/** Reverses `escapeSchluessel`. */
export function unescapeSchluessel(line: string): string {
  return line.replace(SCHLUESSEL_ESCAPED, '$1:');
}

/** „2026-11-20“ → „20.11.2026“. */
export function datumText(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : iso;
}

/** „20.11.2026“, „20.11.26“, „2026-11-20“ → „2026-11-20“; `null` when it is no date. */
export function parseDatum(value: string): string | null {
  const text = value.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  let [year, month, day] = match ? [match[1], match[2], match[3]] : ['', '', ''];
  if (!match) {
    match = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})$/.exec(text);
    if (!match) return null;
    [day, month, year] = [match[1], match[2], match[3].length === 2 ? `20${match[3]}` : match[3]];
  }
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** „18:00“, „9.30“, „18 Uhr“, „18:00 Uhr“ → „HH:MM“; `null` when it is no time. */
export function parseUhrzeit(value: string): string | null {
  const match = /^(\d{1,2})(?:[:.](\d{2}))?(?:\s*Uhr)?$/i.exec(value.trim());
  if (!match || (!match[2] && !/uhr$/i.test(value.trim()))) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** „12.07.2026“ or „12.07.2026 – 19.07.2026“. */
export function zeitraumText(zeitraum: ProtokollZeitraum): string {
  const start = datumText(zeitraum.start);
  return zeitraum.ende && zeitraum.ende !== zeitraum.start
    ? `${start} – ${datumText(zeitraum.ende)}`
    : start;
}

function escapeFeld(value: string): string {
  return value.replace(/;/g, '\\;');
}

function namen(personen: ProtokollPerson[]): string {
  return personen.map((person) => escapeFeld(person.name)).join(', ');
}

/** „Aufgabe: Zelte prüfen; zuständig: Max, Erika; bis: 20.11.2026“ */
export function aufgabeZeile(aufgabe: ProtokollAufgabe): string {
  const teile = [`Aufgabe: ${escapeFeld(aufgabe.titel)}`.trimEnd()];
  if (aufgabe.zustaendig.length > 0) teile.push(`zuständig: ${namen(aufgabe.zustaendig)}`);
  if (aufgabe.faellig) teile.push(`bis: ${datumText(aufgabe.faellig)}`);
  return teile.join('; ');
}

/** „Termin: Arbeitseinsatz; am: 22.11.2026; um: 10:00; in: Pfarrheim; zuständig: Erika“ */
export function terminZeile(termin: PunktTermin): string {
  const teile = [`Termin: ${escapeFeld(termin.titel)}`.trimEnd()];
  if (termin.datum) teile.push(`am: ${datumText(termin.datum)}`);
  if (termin.uhrzeit) teile.push(`um: ${termin.uhrzeit}`);
  if (termin.ort) teile.push(`in: ${escapeFeld(termin.ort)}`);
  if (termin.zustaendig.length > 0) teile.push(`zuständig: ${namen(termin.zustaendig)}`);
  return teile.join('; ');
}

/** Finds the people by name, so a name from the list keeps its login. */
export type PersonFinder = (name: string) => ProtokollPerson;

/** Name without case, accents and extra spaces, as people type it. */
function nameKey(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Looks names up in the given people; an unknown name stays a person without login. */
export function personFinder(personen: Iterable<ProtokollPerson>): PersonFinder {
  const byName = new Map<string, ProtokollPerson>();
  for (const person of personen) {
    const key = nameKey(person.name);
    // A person with login wins over the same name typed by hand
    if (key && (!byName.has(key) || (person.login && !byName.get(key)?.login))) {
      byName.set(key, { login: person.login, name: person.name });
    }
  }
  return (name) => byName.get(nameKey(name)) ?? { login: '', name: name.trim() };
}

/** Splits at `;` that is not escaped and removes the escapes. */
function felder(rest: string): string[] {
  return rest.split(/(?<!\\);/).map((teil) => teil.replace(/\\;/g, ';').trim());
}

const FELD = /^([\p{L}]+)[ \t]*:[ \t]*(.*)$/u;

interface FeldErgebnis {
  titel: string;
  werte: Map<string, string>;
  probleme: string[];
}

/** Title and the named fields of a keyword line; unknown fields stay in the title. */
function leseFelder(line: string, erlaubt: Record<string, string>, beispiel: string): FeldErgebnis {
  const [kopf, ...rest] = felder(line.replace(SCHLUESSEL_ZEILE, ''));
  const titel = [kopf];
  const werte = new Map<string, string>();
  const probleme: string[] = [];
  for (const teil of rest) {
    const match = FELD.exec(teil);
    const feld = match ? erlaubt[match[1].toLowerCase()] : undefined;
    if (match && feld) {
      werte.set(feld, match[2].trim());
    } else {
      titel.push(teil);
      if (match) probleme.push(`„${match[1]}:“ wird nicht erkannt, möglich sind ${beispiel}.`);
    }
  }
  return { titel: titel.filter(Boolean).join('; '), werte, probleme };
}

function lesePersonen(value: string | undefined, finde: PersonFinder): ProtokollPerson[] {
  if (!value) return [];
  return value
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map(finde);
}

function leseDatum(value: string | undefined, probleme: string[]): string {
  if (!value) return '';
  const datum = parseDatum(value);
  if (datum === null) probleme.push(`„${value}“ ist kein Datum, schreib es als TT.MM.JJJJ.`);
  return datum ?? '';
}

export interface GeleseneZeile<T> {
  wert: T;
  probleme: string[];
}

/** Reads „Aufgabe: …“; the id is set when the item is put together. */
export function leseAufgabe(
  line: string,
  finde: PersonFinder
): GeleseneZeile<Omit<ProtokollAufgabe, 'id'>> {
  const { titel, werte, probleme } = leseFelder(
    line,
    { zuständig: 'zustaendig', zustaendig: 'zustaendig', wer: 'zustaendig', bis: 'faellig' },
    '„zuständig:“ und „bis:“'
  );
  if (!titel) probleme.push('Die Aufgabe hat keinen Titel.');
  return {
    wert: {
      titel,
      zustaendig: lesePersonen(werte.get('zustaendig'), finde),
      faellig: leseDatum(werte.get('faellig'), probleme),
    },
    probleme,
  };
}

/** Reads „Termin: …“; the id is set when the item is put together. */
export function leseTermin(
  line: string,
  finde: PersonFinder
): GeleseneZeile<Omit<PunktTermin, 'id'>> {
  const { titel, werte, probleme } = leseFelder(
    line,
    {
      am: 'datum',
      um: 'uhrzeit',
      in: 'ort',
      ort: 'ort',
      zuständig: 'zustaendig',
      zustaendig: 'zustaendig',
      wer: 'zustaendig',
    },
    '„am:“, „um:“, „in:“ und „zuständig:“'
  );
  const datum = leseDatum(werte.get('datum'), probleme);
  if (!werte.has('datum')) probleme.push('Der Termin braucht ein Datum: „am: TT.MM.JJJJ“.');
  const zeit = werte.get('uhrzeit');
  const uhrzeit = zeit ? parseUhrzeit(zeit) : '';
  if (uhrzeit === null) probleme.push(`„${zeit}“ ist keine Uhrzeit, schreib sie als HH:MM.`);
  return {
    wert: {
      titel,
      datum,
      uhrzeit: uhrzeit ?? '',
      ort: werte.get('ort') ?? '',
      zustaendig: lesePersonen(werte.get('zustaendig'), finde),
    },
    probleme,
  };
}

/** Reads „Zeitraum: 12.07.2026“ or „Zeitraum: 12.07.2026 – 19.07.2026“ (also „bis“). */
export function leseZeitraum(line: string): GeleseneZeile<ProtokollZeitraum | null> {
  const rest = line.replace(SCHLUESSEL_ZEILE, '').trim();
  const probleme: string[] = [];
  if (!rest) return { wert: null, probleme };
  const [von, bis = ''] = rest.split(/\s+(?:-|bis)\s+|\s*–\s*|(?<=\d)-(?=\d{1,2}\.)/);
  const start = leseDatum(von, probleme);
  const ende = leseDatum(bis, probleme);
  return { wert: start || ende ? { start, ende: ende === start ? '' : ende } : null, probleme };
}
