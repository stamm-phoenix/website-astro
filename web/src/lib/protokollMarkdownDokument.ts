import {
  aufgabeZeile,
  escapeSchluessel,
  leseAufgabe,
  leseTermin,
  leseZeitraum,
  schluesselOf,
  terminZeile,
  unescapeSchluessel,
  zeitraumText,
} from './protokollMarkdownZeilen';
import type { PersonFinder } from './protokollMarkdownZeilen';
import {
  MAX_AUFGABEN,
  MAX_PUNKTE,
  MAX_TERMINE,
  MAX_TEXT,
  MAX_TITEL,
  MAX_UNTERPUNKTE,
  MAX_ZUSTAENDIG,
} from '../../../api/lib/protokoll-editor-model';
import type {
  ProtokollAufgabe,
  ProtokollPunkt,
  ProtokollZeitraum,
  PunktTermin,
} from '../../../api/lib/protokoll-editor-model';

/**
 * The agenda as one Markdown document (#613): `# Titel` starts an item, `## Titel` a sub-item,
 * then an optional „Zeitraum:“ line, the text, and one line per „Aufgabe:“ and „Termin:“.
 * Headings in a text move two levels down (`## X` is written `#### X`), and text lines that
 * start like a keyword line are escaped, so the document reads back into the same items.
 * `protokollMarkdownAbgleich.ts` matches the items read back to the items before.
 */

const TITEL = /^ {0,3}(#{1,2})(?:[ \t]+(.*?))?[ \t]*$/;
const UEBERSCHRIFT = /^( {0,3})(#{1,6})(?=[ \t]|$)/;
const ZAUN = /^ {0,3}(`{3,}|~{3,})/;

/** Follows fenced code blocks line by line; their lines are never headings or keyword lines. */
class Zaun {
  private offen: string | null = null;

  /** Whether `line` is code; call it for every line in order. */
  code(line: string): boolean {
    const match = ZAUN.exec(line);
    if (this.offen) {
      if (match && match[1][0] === this.offen[0] && match[1].length >= this.offen.length) {
        if (line.slice(line.indexOf(match[1]) + match[1].length).trim() === '') this.offen = null;
      }
      return true;
    }
    if (
      match &&
      !(match[1][0] === '`' && line.slice(match.index + match[0].length).includes('`'))
    ) {
      this.offen = match[1];
      return true;
    }
    return false;
  }

  get zaun(): string | null {
    return this.offen;
  }
}

function ohneLeerzeilenAussen(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end);
}

/** The text of an item as it stands in the document. */
export function textImDokument(text: string): string {
  const zaun = new Zaun();
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      if (zaun.code(line)) return line;
      const escaped = escapeSchluessel(line);
      return escaped.replace(UEBERSCHRIFT, (_, indent: string, hashes: string) => {
        return `${indent}${'#'.repeat(Math.min(6, hashes.length + 2))}`;
      });
    });
  // A code block left open in a text would swallow the items after it
  if (zaun.zaun) lines.push(zaun.zaun);
  return ohneLeerzeilenAussen(lines).join('\n');
}

/** Reverses `textImDokument` for the lines of one item. */
function textAusDokument(lines: string[]): string {
  const zaun = new Zaun();
  return lines
    .map((line) => {
      if (zaun.code(line)) return line;
      return unescapeSchluessel(line).replace(UEBERSCHRIFT, (_, indent: string, hashes: string) => {
        return `${indent}${'#'.repeat(Math.max(1, hashes.length - 2))}`;
      });
    })
    .join('\n');
}

function punktBlock(punkt: ProtokollPunkt, marker: '#' | '##'): string {
  const lines = [`${marker} ${punkt.titel.replace(/\s+/g, ' ')}`.trimEnd()];
  if (punkt.zeitraum && (punkt.zeitraum.start || punkt.zeitraum.ende)) {
    lines.push(`Zeitraum: ${zeitraumText(punkt.zeitraum)}`);
  }
  const text = textImDokument(punkt.text);
  if (text) lines.push('', text);
  const extras = [...punkt.aufgaben.map(aufgabeZeile), ...punkt.termine.map(terminZeile)];
  if (extras.length > 0) lines.push('', ...extras);
  return lines.join('\n');
}

/** The whole agenda as Markdown. */
export function dokumentText(punkte: ProtokollPunkt[]): string {
  const blocks: string[] = [];
  for (const punkt of punkte) {
    blocks.push(punktBlock(punkt, '#'));
    for (const sub of punkt.unterpunkte) blocks.push(punktBlock(sub, '##'));
  }
  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '';
}

/** One item read from the document, in reading order; sub-items have `ebene` 1. */
export interface GelesenerPunkt {
  ebene: 0 | 1;
  titel: string;
  zeitraum: ProtokollZeitraum | null;
  /** The text as it stands in the document, to notice an untouched text. */
  textImDokument: string;
  text: string;
  aufgaben: Omit<ProtokollAufgabe, 'id'>[];
  /** The lines as written by `aufgabeZeile`, to notice an untouched task. */
  aufgabeZeilen: string[];
  termine: Omit<PunktTermin, 'id'>[];
  terminZeilen: string[];
  /** Line of the title, counted from 0; the text before the first item starts at 0. */
  zeile: number;
}

export interface DokumentProblem {
  /** Counted from 1, as people count lines. */
  zeile: number;
  text: string;
}

export interface GelesenesDokument {
  punkte: GelesenerPunkt[];
  probleme: DokumentProblem[];
}

interface Entwurf {
  punkt: GelesenerPunkt;
  text: string[];
  /** A „Zeitraum:“ line was read, so a second one is reported. */
  zeitraumZeile: number | null;
}

function neuerEntwurf(ebene: 0 | 1, titel: string, zeile: number): Entwurf {
  return {
    punkt: {
      ebene,
      titel,
      zeitraum: null,
      textImDokument: '',
      text: '',
      aufgaben: [],
      aufgabeZeilen: [],
      termine: [],
      terminZeilen: [],
      zeile,
    },
    text: [],
    zeitraumZeile: null,
  };
}

function abschliessen(entwurf: Entwurf): GelesenerPunkt {
  const lines = ohneLeerzeilenAussen(entwurf.text);
  const { punkt } = entwurf;
  punkt.textImDokument = lines.join('\n');
  punkt.text = textAusDokument(lines);
  punkt.aufgabeZeilen = punkt.aufgaben.map((aufgabe) => aufgabeZeile({ id: '', ...aufgabe }));
  punkt.terminZeilen = punkt.termine.map((termin) => terminZeile({ id: '', ...termin }));
  return punkt;
}

/** Reads the document into items; problems are reported, never fatal, so no typing is lost. */
export function liesDokument(text: string, finde: PersonFinder): GelesenesDokument {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const punkte: GelesenerPunkt[] = [];
  const probleme: DokumentProblem[] = [];
  const melde = (zeile: number, meldung: string): void => {
    probleme.push({ zeile: zeile + 1, text: meldung });
  };
  const zaun = new Zaun();
  let zaunStart = 0;
  let aktuell: Entwurf | null = null;
  let hauptpunkt = false;

  for (const [index, line] of lines.entries()) {
    const warOffen = zaun.zaun;
    if (zaun.code(line)) {
      if (!warOffen) zaunStart = index;
      if (!aktuell) aktuell = neuerEntwurf(0, '', index);
      aktuell.text.push(line);
      continue;
    }
    const titel = TITEL.exec(line);
    if (titel) {
      if (aktuell) punkte.push(abschliessen(aktuell));
      let ebene: 0 | 1 = titel[1].length === 1 ? 0 : 1;
      if (ebene === 1 && !hauptpunkt) {
        melde(
          index,
          'Ein Unterpunkt (##) braucht einen Hauptpunkt (#) darüber, er zählt als Hauptpunkt.'
        );
        ebene = 0;
      }
      hauptpunkt = true;
      aktuell = neuerEntwurf(ebene, titel[2] ?? '', index);
      continue;
    }
    const schluessel = schluesselOf(line);
    if (!aktuell) {
      if (line.trim() === '') continue;
      melde(index, 'Text vor der ersten Überschrift „# …“ steht in einem Punkt ohne Titel.');
      aktuell = neuerEntwurf(0, '', index);
      hauptpunkt = true;
    }
    const entwurf: Entwurf = aktuell;
    if (schluessel === 'Aufgabe') {
      const { wert, probleme: fehler } = leseAufgabe(line, finde);
      entwurf.punkt.aufgaben.push(wert);
      for (const meldung of fehler) melde(index, meldung);
    } else if (schluessel === 'Termin') {
      const { wert, probleme: fehler } = leseTermin(line, finde);
      entwurf.punkt.termine.push(wert);
      for (const meldung of fehler) melde(index, meldung);
    } else if (schluessel === 'Zeitraum') {
      const { wert, probleme: fehler } = leseZeitraum(line);
      if (entwurf.zeitraumZeile !== null) {
        melde(
          index,
          `Der Punkt hat schon einen Zeitraum in Zeile ${entwurf.zeitraumZeile + 1}, dieser gilt.`
        );
      }
      entwurf.zeitraumZeile = index;
      entwurf.punkt.zeitraum = wert;
      for (const meldung of fehler) melde(index, meldung);
    } else {
      entwurf.text.push(line);
    }
  }
  if (aktuell) punkte.push(abschliessen(aktuell));
  if (zaun.zaun) {
    melde(
      zaunStart,
      `Der Codeblock ab hier ist nicht geschlossen, alles danach gehört zu seinem Punkt. Schließ ihn mit ${zaun.zaun}.`
    );
  }
  return { punkte, probleme: probleme.sort((a, b) => a.zeile - b.zeile) };
}

/** The item (index in reading order) the line belongs to; `null` before the first one. */
export function punktAnZeile(
  punkte: readonly Pick<GelesenerPunkt, 'zeile'>[],
  zeile: number
): number | null {
  let found: number | null = null;
  punkte.forEach((punkt, index) => {
    if (punkt.zeile <= zeile) found = index;
  });
  return found ?? (punkte.length > 0 ? 0 : null);
}

/** Limits the server checks on saving, reported at the line where they are crossed. */
export function grenzen(punkte: GelesenerPunkt[]): DokumentProblem[] {
  const probleme: DokumentProblem[] = [];
  const melde = (punkt: GelesenerPunkt, text: string): void => {
    probleme.push({ zeile: punkt.zeile + 1, text });
  };
  let hauptpunkte = 0;
  let unterpunkte = 0;
  for (const punkt of punkte) {
    if (punkt.ebene === 0) {
      hauptpunkte++;
      unterpunkte = 0;
      if (hauptpunkte === MAX_PUNKTE + 1) {
        melde(punkt, `Mehr als ${MAX_PUNKTE} Punkte lassen sich nicht speichern.`);
      }
    } else if (++unterpunkte === MAX_UNTERPUNKTE + 1) {
      melde(
        punkt,
        `Mehr als ${MAX_UNTERPUNKTE} Unterpunkte in einem Punkt lassen sich nicht speichern.`
      );
    }
    if (punkt.titel.length > MAX_TITEL) {
      melde(
        punkt,
        `Der Titel ist länger als ${MAX_TITEL} Zeichen und lässt sich so nicht speichern.`
      );
    }
    if (punkt.text.length > MAX_TEXT) {
      melde(
        punkt,
        `Der Text ist länger als ${MAX_TEXT.toLocaleString('de-DE')} Zeichen und lässt sich so nicht speichern.`
      );
    }
    if (punkt.aufgaben.length > MAX_AUFGABEN) {
      melde(punkt, `Mehr als ${MAX_AUFGABEN} Aufgaben in einem Punkt lassen sich nicht speichern.`);
    }
    if (punkt.termine.length > MAX_TERMINE) {
      melde(punkt, `Mehr als ${MAX_TERMINE} Termine in einem Punkt lassen sich nicht speichern.`);
    }
    if ([...punkt.aufgaben, ...punkt.termine].some((e) => e.zustaendig.length > MAX_ZUSTAENDIG)) {
      melde(
        punkt,
        `Mehr als ${MAX_ZUSTAENDIG} Zuständige je Aufgabe oder Termin lassen sich nicht speichern.`
      );
    }
  }
  return probleme;
}
