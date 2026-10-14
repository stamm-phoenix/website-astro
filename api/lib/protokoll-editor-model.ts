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

/** A date agreed in the meeting, e.g. a work day or the next Elternabend. */
export interface PunktTermin {
  id: string;
  titel: string;
  /** `YYYY-MM-DD`; empty only while it is being typed. */
  datum: string;
  /** `HH:MM` or empty. */
  uhrzeit: string;
  ort: string;
  zustaendig: ProtokollPerson[];
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
  /** Markdown (CommonMark and GFM), rendered without HTML (`web/src/lib/protokollMarkdown.ts`). */
  text: string;
  aufgaben: ProtokollAufgabe[];
  /** Missing in minutes stored before #297; read as an empty list. */
  termine: PunktTermin[];
  unterpunkte: ProtokollPunkt[];
}

export interface ProtokollKopf {
  /** Stored as one string before #301; such a name is read as one person without login. */
  sitzungsleitung: ProtokollPerson[];
  protokollant: ProtokollPerson[];
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

/** The mailing to all leaders; `attempted` stays if it is unknown whether the mail went out. */
export interface ProtokollEditorVersand {
  state: 'attempted' | 'sent';
  recipients: number;
  at: string;
  by: string;
}

/** The PDF filed in the folder of the minutes on approval. */
export interface ProtokollEditorAblage {
  fileName: string;
  webUrl: string;
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
  /** Who gave the minutes to the review last, and when; empty before. */
  submittedBy: string;
  submittedAt: string;
  /** Why a reviewer sent the minutes back; empty otherwise. */
  reviewNote: string;
  approvedBy: string;
  approvedAt: string;
  ablage: ProtokollEditorAblage | null;
  versand: ProtokollEditorVersand | null;
  /** Whether the user may approve, send back and mail minutes (`CONFIG.protokolle.reviewers`). */
  reviewer: boolean;
  /** Whether a sender for the mail is set up. */
  sendingConfigured: boolean;
}

/** Steps of the review: give to review, approve (files the PDF) or send back with a note. */
export type ProtokollReviewAction = 'review' | 'approve' | 'reject';

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

/** Where a person to pick comes from; the picker groups them in this order. */
export type PersonGruppe = 'leitende' | 'altleitende' | 'weitere';

export const PERSON_GRUPPEN: PersonGruppe[] = ['leitende', 'altleitende', 'weitere'];

export const PERSON_GRUPPE_LABELS: Record<PersonGruppe, string> = {
  leitende: 'Leitende',
  altleitende: 'Altleitende',
  weitere: 'Weitere',
};

/** A person to pick: from the Entra group of the leaders or the list of further people. */
export interface PersonOption extends ProtokollPerson {
  gruppe: PersonGruppe;
}

/** People to pick for the names in the minutes. */
export interface ProtokollEditorPersonen {
  personen: PersonOption[];
  /** The directory could not be read; names can still be typed. */
  unavailable: boolean;
}

/** A person of the list kept in the Leitendenbereich (Altleitende and others, #301). */
export interface WeiterePerson {
  id: number;
  name: string;
  /** Login in our tenant, if the person has one; empty otherwise. */
  login: string;
  gruppe: Exclude<PersonGruppe, 'leitende'>;
  /** Inactive people stay in old minutes but are no longer offered. */
  aktiv: boolean;
  etag: string;
  updatedAt: string;
  updatedBy: string;
}

/** Seconds a lock lasts without being renewed. */
export const SPERRE_SECONDS = 60;
/** Seconds between renewals of the writing browser. */
export const SPERRE_RENEW_SECONDS = 20;

export const MAX_PUNKTE = 40;
export const MAX_UNTERPUNKTE = 20;
export const MAX_AUFGABEN = 30;
export const MAX_TERMINE = 20;
export const MAX_ZUSTAENDIG = 10;
/** People in the Sitzungsleitung (the Vorstand is preset) and writing the minutes. */
export const MAX_SITZUNGSLEITUNG = 5;
export const MAX_PROTOKOLLANT = 1;
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
  return { id, titel, aktion: null, text: '', aufgaben: [], termine: [], unterpunkte: [] };
}

/** Content of new minutes with the standard agenda; `nextId` creates unique IDs. */
export function neuerInhalt(
  nextId: () => string,
  kopf: Partial<ProtokollKopf> = {}
): ProtokollInhalt {
  return {
    kopf: {
      sitzungsleitung: [],
      protokollant: [],
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

/** Names of people for reading: „Vera Vorstand, Volker Vorstand“. */
export function personNames(list: ProtokollPerson[]): string {
  return list
    .map((p) => p.name.trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Brings content written before #297 and #301 into the current shape: a missing `termine`
 * becomes an empty list, a Sitzungsleitung or Protokoll typed as one string becomes one person
 * without login. Used for local copies in the browser; the server does the same while checking.
 */
export function upgradeInhalt(inhalt: ProtokollInhalt): ProtokollInhalt {
  const people = (value: unknown): ProtokollPerson[] => {
    if (Array.isArray(value)) return value as ProtokollPerson[];
    return typeof value === 'string' && value.trim() ? [{ login: '', name: value }] : [];
  };
  const punkt = (p: ProtokollPunkt): ProtokollPunkt => ({
    ...p,
    termine: Array.isArray(p.termine) ? p.termine : [],
    unterpunkte: (p.unterpunkte ?? []).map(punkt),
  });
  return {
    ...inhalt,
    kopf: {
      ...inhalt.kopf,
      sitzungsleitung: people(inhalt.kopf.sitzungsleitung),
      protokollant: people(inhalt.kopf.protokollant),
    },
    punkte: inhalt.punkte.map(punkt),
  };
}
