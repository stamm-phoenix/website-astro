/**
 * Correction proposals for written minutes (#553, `docs/protokoll-editor.md`): the shapes and
 * the rules that decide whether a proposal still fits the text. Shared with the frontend
 * (`web/src/lib/protokollKorrektur.ts`), so keep this module free of runtime imports and
 * Node/browser-specific APIs.
 */
import type { ProtokollInhalt, ProtokollPunkt } from './protokoll-editor-model';
import { punktNummer } from './protokoll-editor-inhalt';

/**
 * rechtschreibung: spelling, grammar, punctuation; stil: unclear, doubled or too long sentences;
 * einheitlich: inconsistent spellings of names, Aktionen or dates; rueckfrage: something seems
 * to be missing or unclear, only a note without a replacement.
 */
export type KorrekturArt = 'rechtschreibung' | 'stil' | 'einheitlich' | 'rueckfrage';

export const KORREKTUR_ARTEN: readonly KorrekturArt[] = [
  'rechtschreibung',
  'stil',
  'einheitlich',
  'rueckfrage',
];

export const KORREKTUR_ART_LABELS: Record<KorrekturArt, string> = {
  rechtschreibung: 'Rechtschreibung',
  stil: 'Verständlichkeit',
  einheitlich: 'Einheitliche Schreibweise',
  rueckfrage: 'Rückfrage',
};

/** The field of an agenda item a proposal is about. */
export type KorrekturFeld = 'titel' | 'text' | 'aufgabe' | 'termin' | 'termin-ort';

export const KORREKTUR_FELDER: readonly KorrekturFeld[] = [
  'titel',
  'text',
  'aufgabe',
  'termin',
  'termin-ort',
];

/** Where a proposal applies: the item, its field and, for tasks and dates, their ID. */
export interface KorrekturStelle {
  punktId: string;
  feld: KorrekturFeld;
  /** ID of the task or date for `aufgabe`, `termin` and `termin-ort`; null otherwise. */
  elementId: string | null;
}

export interface KorrekturVorschlag extends KorrekturStelle {
  /** Short ID within one check, e.g. `k3`. */
  id: string;
  art: KorrekturArt;
  /** The passage as it stands in the field; empty for a note about a missing value. */
  vorher: string;
  /** The replacement; empty for a `rueckfrage`. */
  nachher: string;
  /** Why, in one short sentence. */
  begruendung: string;
}

/** Answer of the check. */
export interface KorrekturPruefung {
  vorschlaege: KorrekturVorschlag[];
  /** Items whose part of the check failed, e.g. „2. Finanzen“; empty when all were checked. */
  nichtGeprueft: string[];
}

/** Proposals to take over, as the page sends them. */
export interface KorrekturUebernahme extends KorrekturStelle {
  id: string;
  vorher: string;
  nachher: string;
}

/** Answer of taking over: the new version and which proposals no longer fit the text. */
export interface KorrekturUebernahmeResponse {
  etag: string;
  updatedAt: string;
  uebernommen: string[];
  geaendert: string[];
}

export const MAX_VORSCHLAEGE = 60;
export const MAX_VORSCHLAG_TEXT = 1000;
export const MAX_BEGRUENDUNG = 300;

/** The item with this ID, also among the sub-items, with its number („2.“, „2a.“). */
export function findePunkt(
  inhalt: ProtokollInhalt,
  punktId: string
): { punkt: ProtokollPunkt; nummer: string } | undefined {
  for (const [index, punkt] of inhalt.punkte.entries()) {
    if (punkt.id === punktId) return { punkt, nummer: punktNummer(index) };
    for (const [subIndex, sub] of punkt.unterpunkte.entries()) {
      if (sub.id === punktId) return { punkt: sub, nummer: punktNummer(index, subIndex) };
    }
  }
  return undefined;
}

/** The current text of the field; undefined if the item, task or date is gone. */
export function feldText(inhalt: ProtokollInhalt, stelle: KorrekturStelle): string | undefined {
  const punkt = findePunkt(inhalt, stelle.punktId)?.punkt;
  if (!punkt) return undefined;
  switch (stelle.feld) {
    case 'titel':
      return punkt.titel;
    case 'text':
      return punkt.text;
    case 'aufgabe':
      return punkt.aufgaben.find((aufgabe) => aufgabe.id === stelle.elementId)?.titel;
    case 'termin':
      return punkt.termine.find((termin) => termin.id === stelle.elementId)?.titel;
    case 'termin-ort':
      return punkt.termine.find((termin) => termin.id === stelle.elementId)?.ort;
  }
}

/** How often `teil` occurs in `text`, counting non-overlapping matches. */
function vorkommen(text: string, teil: string): number {
  if (teil === '') return 0;
  let count = 0;
  for (let at = text.indexOf(teil); at !== -1; at = text.indexOf(teil, at + teil.length)) count++;
  return count;
}

/**
 * Whether the replacement can be made: the passage stands exactly once in the field, so it
 * is clear where it goes and that the text did not change since the check.
 */
export function passtNoch(
  inhalt: ProtokollInhalt,
  vorschlag: KorrekturStelle & { vorher: string; nachher: string }
): boolean {
  const text = feldText(inhalt, vorschlag);
  return (
    text !== undefined &&
    vorschlag.vorher !== vorschlag.nachher &&
    vorkommen(text, vorschlag.vorher) === 1
  );
}

/** Whether the passage of a note can still be found, or the note is about the field as a whole. */
export function stelleVorhanden(
  inhalt: ProtokollInhalt,
  vorschlag: KorrekturStelle & { vorher: string }
): boolean {
  const text = feldText(inhalt, vorschlag);
  return text !== undefined && (vorschlag.vorher === '' || text.includes(vorschlag.vorher));
}

function mitFeld(punkt: ProtokollPunkt, stelle: KorrekturStelle, neu: string): ProtokollPunkt {
  switch (stelle.feld) {
    case 'titel':
      return { ...punkt, titel: neu };
    case 'text':
      return { ...punkt, text: neu };
    case 'aufgabe':
      return {
        ...punkt,
        aufgaben: punkt.aufgaben.map((a) => (a.id === stelle.elementId ? { ...a, titel: neu } : a)),
      };
    case 'termin':
      return {
        ...punkt,
        termine: punkt.termine.map((t) => (t.id === stelle.elementId ? { ...t, titel: neu } : t)),
      };
    case 'termin-ort':
      return {
        ...punkt,
        termine: punkt.termine.map((t) => (t.id === stelle.elementId ? { ...t, ort: neu } : t)),
      };
  }
}

/**
 * The minutes with the proposal made, or null if it no longer fits (`passtNoch`). Leaves
 * `inhalt` untouched.
 */
export function wendeKorrekturAn(
  inhalt: ProtokollInhalt,
  vorschlag: KorrekturStelle & { vorher: string; nachher: string }
): ProtokollInhalt | null {
  if (!passtNoch(inhalt, vorschlag)) return null;
  const text = feldText(inhalt, vorschlag) ?? '';
  const neu = text.replace(vorschlag.vorher, () => vorschlag.nachher);
  const ersetze = (punkt: ProtokollPunkt): ProtokollPunkt =>
    punkt.id === vorschlag.punktId
      ? mitFeld(punkt, vorschlag, neu)
      : { ...punkt, unterpunkte: punkt.unterpunkte.map(ersetze) };
  return { ...inhalt, punkte: inhalt.punkte.map(ersetze) };
}

/** Notes about tasks without a person or due date and dates without a day; no model needed. */
export function fehlendeAngaben(inhalt: ProtokollInhalt): Omit<KorrekturVorschlag, 'id'>[] {
  const result: Omit<KorrekturVorschlag, 'id'>[] = [];
  const pruefe = (punkt: ProtokollPunkt): void => {
    for (const aufgabe of punkt.aufgaben) {
      if (!aufgabe.titel.trim()) continue;
      const fehlt = [
        aufgabe.zustaendig.length === 0 ? 'wer sich kümmert' : '',
        aufgabe.faellig ? '' : 'bis wann',
      ].filter(Boolean);
      if (fehlt.length === 0) continue;
      result.push({
        punktId: punkt.id,
        feld: 'aufgabe',
        elementId: aufgabe.id,
        art: 'rueckfrage',
        vorher: '',
        nachher: '',
        begruendung: `Bei dieser Aufgabe fehlt, ${fehlt.join(' und ')}.`,
      });
    }
    for (const termin of punkt.termine) {
      if (termin.datum || !termin.titel.trim()) continue;
      result.push({
        punktId: punkt.id,
        feld: 'termin',
        elementId: termin.id,
        art: 'rueckfrage',
        vorher: '',
        nachher: '',
        begruendung: 'Bei diesem Termin fehlt das Datum.',
      });
    }
    punkt.unterpunkte.forEach(pruefe);
  };
  inhalt.punkte.forEach(pruefe);
  return result;
}
