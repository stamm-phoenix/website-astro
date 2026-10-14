/**
 * Shapes of the Protokoll-Editor (#277, `docs/protokoll-editor.md`). Shared with the frontend
 * (`web/src/lib/types.ts`), so keep this module free of imports and Node/browser-specific APIs.
 */

/** entwurf: being written; the others follow with review and mailing. */
export type ProtokollEditorStatus = 'entwurf' | 'review' | 'freigegeben' | 'verschickt';

/** A person from the directory, or one typed by hand (`login` empty). */
export interface ProtokollPerson {
  login: string;
  name: string;
}

export type ProtokollAnwesenheit = 'anwesend' | 'entschuldigt';

export interface ProtokollTeilnahme extends ProtokollPerson {
  status: ProtokollAnwesenheit;
}

/** A task agreed in the meeting; becomes a real task with the review (later step of #277). */
export interface ProtokollAufgabe {
  id: string;
  titel: string;
  zustaendig: ProtokollPerson[];
  /** `YYYY-MM-DD` or empty. */
  faellig: string;
}

/** The CampFlow event an agenda item was created from; its dates are shown below the title. */
export interface ProtokollAktion {
  /** CampFlow ID */
  id: string;
  titel: string;
  /** `YYYY-MM-DD` or empty, as in CampFlow when the item was created. */
  start: string;
  ende: string;
}

/** An item of the agenda; sub-items have no sub-items of their own. */
export interface ProtokollPunkt {
  id: string;
  titel: string;
  /** Set for items about an Aktion, `null` for all others. */
  aktion: ProtokollAktion | null;
  /** Plain text with a few marks: `- ` lists and `**bold**` (see `parseProtokollText`). */
  text: string;
  aufgaben: ProtokollAufgabe[];
  unterpunkte: ProtokollPunkt[];
}

export interface ProtokollKopf {
  sitzungsleitung: string;
  protokollant: string;
  /** `HH:MM` or empty. */
  beginn: string;
  ende: string;
  teilnehmende: ProtokollTeilnahme[];
  /** Guests, as typed. */
  externe: string;
}

export interface ProtokollNaechsteSitzung {
  /** `YYYY-MM-DD` or empty. */
  datum: string;
  /** `HH:MM` or empty. */
  uhrzeit: string;
  ort: string;
}

/** Everything written in the editor, stored as one JSON document. */
export interface ProtokollInhalt {
  kopf: ProtokollKopf;
  punkte: ProtokollPunkt[];
  naechsteSitzung: ProtokollNaechsteSitzung;
}

/** Who is writing; the lock runs out unless the writing browser renews it. */
export interface ProtokollSperre {
  login: string;
  name: string;
  since: string;
  until: string;
  /** ID of the agenda item being written, for readers following along. */
  aktiverPunkt: string | null;
  /** Whether the lock belongs to the token sent with the request (this tab). */
  mine: boolean;
  /** Whether the lock ran out; anyone may take it over without asking. */
  expired: boolean;
}

export interface ProtokollEditorListItem {
  id: number;
  title: string;
  /** `YYYY-MM-DD` */
  date: string;
  status: ProtokollEditorStatus;
  createdBy: string;
  updatedAt: string;
  /** Name of the person writing right now, if the lock is held. */
  writer: string | null;
}

export interface ProtokollEditorOverview {
  protokolle: ProtokollEditorListItem[];
  today: string;
  /** Preset title of new minutes. */
  defaultTitle: string;
}

export interface ProtokollEditorDetail {
  id: number;
  title: string;
  date: string;
  status: ProtokollEditorStatus;
  inhalt: ProtokollInhalt;
  etag: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  sperre: ProtokollSperre | null;
  /** Whether the user may delete the minutes (author or reviewer, only drafts). */
  canDelete: boolean;
}

/** Answer of the live check: the full minutes only if they changed since `etag`. */
export interface ProtokollLiveResponse {
  etag: string;
  sperre: ProtokollSperre | null;
  protokoll: ProtokollEditorDetail | null;
}

/** Answer of saving and of taking or renewing the lock. */
export interface ProtokollSaveResponse {
  etag: string;
  updatedAt: string;
  sperre: ProtokollSperre;
}

export type ProtokollRevisionReason =
  'speichern' | 'uebernahme' | 'ueberschreiben' | 'wiederherstellen';

export const REVISION_REASON_LABELS: Record<ProtokollRevisionReason, string> = {
  speichern: 'Automatisch gesichert',
  uebernahme: 'Vor dem Übernehmen der Bearbeitung',
  ueberschreiben: 'Vor dem Übernehmen einer lokalen Fassung',
  wiederherstellen: 'Vor dem Wiederherstellen einer älteren Fassung',
};

export interface ProtokollRevisionListItem {
  id: number;
  savedAt: string;
  savedBy: string;
  reason: ProtokollRevisionReason;
}

export interface ProtokollRevision extends ProtokollRevisionListItem {
  title: string;
  date: string;
  inhalt: ProtokollInhalt;
}

/** People to pick for attendance and tasks. */
export interface ProtokollEditorPersonen {
  personen: ProtokollPerson[];
  /** The directory could not be read; names can still be typed. */
  unavailable: boolean;
}

/** Seconds a lock lasts without being renewed. */
export const SPERRE_SECONDS = 60;
/** Seconds between renewals of the writing browser. */
export const SPERRE_RENEW_SECONDS = 20;

export const MAX_PUNKTE = 40;
export const MAX_UNTERPUNKTE = 20;
export const MAX_AUFGABEN = 30;
export const MAX_ZUSTAENDIG = 10;
export const MAX_TEILNEHMENDE = 150;
export const MAX_TEXT = 20_000;
export const MAX_TITEL = 200;
/** Upper bound of the whole document as JSON. */
export const MAX_INHALT_BYTES = 500_000;

/** IDs of agenda items and tasks, created by the browser. */
export const ELEMENT_ID = /^[a-z0-9-]{1,40}$/;

/** The agenda of the former Word template of the Leitendenrunde. */
export const STANDARD_PUNKTE: { titel: string; unterpunkte: string[] }[] = [
  {
    titel: 'Stufenberichte',
    unterpunkte: ['Wölflinge', 'Jungpfadfinder', 'Pfadfinder', 'Rover', 'StaVos'],
  },
  { titel: 'Reflexion', unterpunkte: [] },
  { titel: 'Planung', unterpunkte: [] },
  { titel: 'Sonstiges', unterpunkte: [] },
];

/** A new agenda item; `id` must be unique within the minutes. */
export function neuerPunkt(id: string, titel = ''): ProtokollPunkt {
  return { id, titel, aktion: null, text: '', aufgaben: [], unterpunkte: [] };
}

/** Content of new minutes with the standard agenda; `nextId` creates unique IDs. */
export function neuerInhalt(
  nextId: () => string,
  kopf: Partial<ProtokollKopf> = {}
): ProtokollInhalt {
  return {
    kopf: {
      sitzungsleitung: '',
      protokollant: '',
      beginn: '',
      ende: '',
      teilnehmende: [],
      externe: '',
      ...kopf,
    },
    punkte: STANDARD_PUNKTE.map((punkt) => ({
      ...neuerPunkt(nextId(), punkt.titel),
      unterpunkte: punkt.unterpunkte.map((titel) => neuerPunkt(nextId(), titel)),
    })),
    naechsteSitzung: { datum: '', uhrzeit: '', ort: '' },
  };
}

/** A piece of a line: plain or bold. */
export interface TextSpan {
  text: string;
  bold: boolean;
}

/** A block of the text: a paragraph (lines kept) or a bulleted list. */
export type TextBlock =
  { kind: 'absatz'; lines: TextSpan[][] } | { kind: 'liste'; items: TextSpan[][] };

/** `a **b** c` → spans; an unmatched `**` stays as written. */
export function parseSpans(line: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    if (match.index > last) spans.push({ text: line.slice(last, match.index), bold: false });
    spans.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < line.length) spans.push({ text: line.slice(last), bold: false });
  return spans;
}

const LIST_ITEM = /^\s*[-*•]\s+/;

/**
 * The few marks of the editor: blank lines separate paragraphs, lines starting with `- `, `* `
 * or `• ` form a list, `**text**` is bold. Everything else is plain text, never HTML.
 */
export function parseProtokollText(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let current: TextBlock | null = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      current = null;
      continue;
    }
    if (LIST_ITEM.test(line)) {
      if (current?.kind !== 'liste') {
        current = { kind: 'liste', items: [] };
        blocks.push(current);
      }
      current.items.push(parseSpans(line.replace(LIST_ITEM, '')));
    } else {
      if (current?.kind !== 'absatz') {
        current = { kind: 'absatz', lines: [] };
        blocks.push(current);
      }
      current.lines.push(parseSpans(line.trim()));
    }
  }
  return blocks;
}

/** „12.–14.06.2026“, „03.10.2026“ or empty: the dates of an Aktion below the title. */
export function aktionZeitraum(aktion: ProtokollAktion): string {
  const format = (date: string): string[] => {
    const [year, month, day] = date.split('-');
    return [day, month, year];
  };
  if (!aktion.start) return '';
  const [d1, m1, y1] = format(aktion.start);
  if (!aktion.ende || aktion.ende === aktion.start) return `${d1}.${m1}.${y1}`;
  const [d2, m2, y2] = format(aktion.ende);
  if (y1 !== y2) return `${d1}.${m1}.${y1}–${d2}.${m2}.${y2}`;
  if (m1 !== m2) return `${d1}.${m1}.–${d2}.${m2}.${y2}`;
  return `${d1}.–${d2}.${m2}.${y2}`;
}

/** „1.“, „1a.“: numbering of an agenda item and its sub-items as in the former template. */
export function punktNummer(index: number, subIndex?: number): string {
  if (subIndex === undefined) return `${index + 1}.`;
  return `${index + 1}${String.fromCharCode(97 + (subIndex % 26))}.`;
}
