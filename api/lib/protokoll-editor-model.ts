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

/** A task agreed in the meeting; becomes a task of the module Aufgaben on approval. */
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

/** A project of the module Aufgaben linked to an agenda item. */
export interface ProtokollProjekt {
  id: number;
  /** As the project was called when it was linked; shown in the minutes. */
  titel: string;
}

/**
 * An open task of the module Aufgaben, discussed in the meeting: in the item „Offene Aufgaben“
 * or in an item linked to its project. A copy, so the minutes keep what was discussed.
 */
export interface OffeneAufgabe {
  /** ID of the task in the module Aufgaben. */
  id: number;
  titel: string;
  zustaendig: ProtokollPerson[];
  /** `YYYY-MM-DD` or empty. */
  faellig: string;
  /** Ticked off in the meeting; the task in the module Aufgaben is done as well. */
  erledigt: boolean;
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
  /**
   * The tasks of the item go into this project on approval, and the item shows its open tasks.
   * Missing in minutes stored before step 3 of #277; read as `null`.
   */
  projekt: ProtokollProjekt | null;
  /** Missing in minutes stored before step 3 of #277; read as an empty list. */
  offeneAufgaben: OffeneAufgabe[];
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
  /** Whether the minutes may be deleted (only drafts). */
  canDelete: boolean;
  /** Who gave the minutes to the review last, and when; empty before. */
  submittedBy: string;
  submittedAt: string;
  /** Why the minutes were sent back from the review; empty otherwise. */
  reviewNote: string;
  approvedBy: string;
  approvedAt: string;
  ablage: ProtokollEditorAblage | null;
  versand: ProtokollEditorVersand | null;
  /** Whether a sender for the mail is set up. */
  sendingConfigured: boolean;
  /** Tasks in the module Aufgaben created by the approval and not deleted since. */
  aufgabenAngelegt: number;
}

/** An open task to show in the minutes, with what decides where it is shown. */
export interface OffeneAufgabeQuelle extends Omit<OffeneAufgabe, 'erledigt'> {
  projektId: number | null;
  /** Created from minutes (approved in the editor or accepted from a Word file). */
  ausProtokoll: boolean;
}

/** A project of the module Aufgaben to link to an agenda item. */
export interface ProtokollProjektOption extends ProtokollProjekt {
  /** CampFlow ID of the Aktion of the project, or empty. */
  campflowId: string;
}

/** Projects and open tasks of the module Aufgaben, for the editor. */
export interface ProtokollEditorAufgaben {
  projekte: ProtokollProjektOption[];
  offen: OffeneAufgabeQuelle[];
  /** Version of every open or done task by ID, sent back when ticking it. */
  versionen: Record<string, string>;
}

/** Answer of approving: the filed PDF and how many tasks were created. */
export interface ProtokollFreigabeResponse {
  fileName: string;
  aufgaben: number;
}

/**
 * Steps of the review: give to review, approve a draft or minutes in review (files the PDF) or
 * send back with a note.
 */
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

/** Seconds a lock lasts without being renewed. */
export const SPERRE_SECONDS = 60;
/** Seconds between renewals of the writing browser. */
export const SPERRE_RENEW_SECONDS = 20;

export const MAX_PUNKTE = 40;
export const MAX_UNTERPUNKTE = 20;
export const MAX_AUFGABEN = 30;
export const MAX_TERMINE = 20;
export const MAX_OFFENE_AUFGABEN = 60;
/** Title of the item with the open tasks from earlier minutes, at the top of new minutes. */
export const OFFENE_AUFGABEN_TITEL = 'Offene Aufgaben';
/** Longest title of a task in the module Aufgaben; a longer one is cut there. */
export const MAX_TASK_TITLE = 200;
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
  return {
    id,
    titel,
    aktion: null,
    text: '',
    aufgaben: [],
    termine: [],
    projekt: null,
    offeneAufgaben: [],
    unterpunkte: [],
  };
}

/**
 * Text from the module Aufgaben as one line for the minutes: line breaks and control characters
 * become spaces, so the copy passes the checks of the minutes (`validateProtokollInhalt`).
 */
export function einzeilig(text: string, max: number = MAX_TITEL): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  );
}

/** A copy of an open task for the minutes, not ticked off yet. */
export function offeneAufgabe(quelle: OffeneAufgabeQuelle): OffeneAufgabe {
  return {
    id: quelle.id,
    titel: quelle.titel,
    zustaendig: quelle.zustaendig.map(({ login, name }) => ({ login, name })),
    faellig: quelle.faellig,
    erledigt: false,
  };
}

/**
 * The open tasks of a project, or with `null` those from earlier minutes, oldest due date
 * first (tasks without one last), at most `MAX_OFFENE_AUFGABEN`.
 */
export function offeneAufgabenFuer(
  offen: OffeneAufgabeQuelle[],
  projektId: number | null
): OffeneAufgabeQuelle[] {
  return offen
    .filter((task) => (projektId === null ? task.ausProtokoll : task.projektId === projektId))
    .sort(
      (a, b) =>
        (a.faellig || '9999').localeCompare(b.faellig || '9999') ||
        a.titel.localeCompare(b.titel, 'de') ||
        a.id - b.id
    )
    .slice(0, MAX_OFFENE_AUFGABEN);
}

/**
 * The open tasks of an item after reloading them, with the state of the module Aufgaben: open
 * ones (`open`) are „Noch offen“, done ones (`erledigt`, IDs of all done tasks) „Erledigt“, also
 * those ticked off in this meeting. New open ones are added, the others keep their place; tasks
 * that are gone or no longer belong here drop out.
 */
export function mergeOffeneAufgaben(
  current: OffeneAufgabe[],
  open: OffeneAufgabeQuelle[],
  erledigt: ReadonlySet<number>
): OffeneAufgabe[] {
  const fresh = new Map(open.map((task) => [task.id, task]));
  const kept = current
    .filter((task) => fresh.has(task.id) || erledigt.has(task.id))
    .map((task) => {
      const update = fresh.get(task.id);
      return update ? offeneAufgabe(update) : { ...task, erledigt: true };
    });
  const known = new Set(kept.map((task) => task.id));
  const added = open.filter((task) => !known.has(task.id)).map(offeneAufgabe);
  return [...kept, ...added].slice(0, MAX_OFFENE_AUFGABEN);
}

/**
 * Data of other modules that new minutes start with. `texte` maps the title of an agenda item
 * or sub-item („Wölflinge“, „Planung“) to its text; `naechsteSitzung` presets the time and place
 * of the next meeting (not the date, which only the writer knows).
 */
export interface Vorbelegung {
  texte: Record<string, string>;
  naechsteSitzung: Pick<ProtokollNaechsteSitzung, 'uhrzeit' | 'ort'>;
}

/**
 * Content of new minutes with the standard agenda; `nextId` creates unique IDs. `vorbelegung`
 * (see `protokoll-vorbelegung.ts`) fills items and sub-items with the same title.
 */
export function neuerInhalt(
  nextId: () => string,
  kopf: Partial<ProtokollKopf> = {},
  vorbelegung: Partial<Vorbelegung> = {}
): ProtokollInhalt {
  const texte = vorbelegung.texte ?? {};
  const text = (titel: string): string => (Object.hasOwn(texte, titel) ? texte[titel] : '');
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
      text: text(punkt.titel),
      unterpunkte: punkt.unterpunkte.map((titel) => ({
        ...neuerPunkt(nextId(), titel),
        text: text(titel),
      })),
    })),
    naechsteSitzung: { datum: '', uhrzeit: '', ort: '', ...vorbelegung.naechsteSitzung },
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

/** How many tasks approving the minutes creates in the module Aufgaben: those with a title. */
export function freigabeAufgaben(inhalt: ProtokollInhalt): number {
  return protokollEintraege(inhalt).length;
}

/** „eine Aufgabe“, „3 Aufgaben“ */
export function aufgabenAnzahl(count: number): string {
  return count === 1 ? 'eine Aufgabe' : `${count} Aufgaben`;
}

/**
 * The item „Offene Aufgaben“ at the top of new minutes: the open tasks from earlier minutes, or
 * `null` if there are none.
 */
export function offeneAufgabenPunkt(
  id: string,
  offen: OffeneAufgabeQuelle[]
): ProtokollPunkt | null {
  const tasks = offeneAufgabenFuer(offen, null);
  if (tasks.length === 0) return null;
  return { ...neuerPunkt(id, OFFENE_AUFGABEN_TITEL), offeneAufgaben: tasks.map(offeneAufgabe) };
}

const MAX_PUNKT_LABEL = 250;

/** A task of the minutes with the item it was agreed in, as it goes to the module Aufgaben. */
export interface ProtokollEintrag {
  aufgabe: ProtokollAufgabe;
  punkt: string;
  projekt: ProtokollProjekt | null;
}

/** „3. Planung“, „1a. Wölflinge“: the item as it is numbered in the minutes. */
function punktLabel(nummer: string, titel: string): string {
  return `${nummer} ${titel.trim() || 'Ohne Titel'}`.slice(0, MAX_PUNKT_LABEL);
}

/** The tasks of all items with a title, in the order of the minutes. */
export function protokollEintraege(inhalt: ProtokollInhalt): ProtokollEintrag[] {
  const eintraege: ProtokollEintrag[] = [];
  const add = (punkt: ProtokollPunkt, nummer: string, projekt: ProtokollProjekt | null): void => {
    for (const aufgabe of punkt.aufgaben) {
      if (aufgabe.titel.trim()) {
        eintraege.push({ aufgabe, punkt: punktLabel(nummer, punkt.titel), projekt });
      }
    }
  };
  inhalt.punkte.forEach((punkt, index) => {
    add(punkt, punktNummer(index), punkt.projekt);
    punkt.unterpunkte.forEach((sub, subIndex) => {
      // A sub-item without a project of its own belongs to the project of its item
      add(sub, punktNummer(index, subIndex), sub.projekt ?? punkt.projekt);
    });
  });
  return eintraege;
}

/** Names of people for reading: „Vera Vorstand, Volker Vorstand“. */
export function personNames(list: ProtokollPerson[]): string {
  return list
    .map((p) => p.name.trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Brings content written before #297, #301 and step 3 of #277 into the current shape: a missing
 * `termine` or `offeneAufgaben` becomes an empty list, a missing `projekt` `null`, a Sitzungsleitung or Protokoll typed as one string becomes one person
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
    projekt: p.projekt ?? null,
    offeneAufgaben: Array.isArray(p.offeneAufgaben) ? p.offeneAufgaben : [],
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
