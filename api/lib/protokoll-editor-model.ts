/**
 * Shapes of the Protokoll-Editor (#277, `docs/protokoll-editor.md`). Shared with the frontend
 * (`web/src/lib/types/`), so keep this module free of imports and Node/browser-specific APIs.
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

/** The day or days an item without Aktion is about (#551), shown below the title like an Aktion's. */
export interface ProtokollZeitraum {
  /** `YYYY-MM-DD` or empty. */
  start: string;
  /** `YYYY-MM-DD` or empty for a single day. */
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
  /** Date or date range typed at the item; missing in minutes stored before #551, read as `null`. */
  zeitraum: ProtokollZeitraum | null;
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
  /** People mentioned with `@` who got a note (#547). */
  benachrichtigt: number;
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
  'speichern' | 'uebernahme' | 'ueberschreiben' | 'wiederherstellen' | 'korrektur';

export const REVISION_REASON_LABELS: Record<ProtokollRevisionReason, string> = {
  speichern: 'Automatisch gesichert',
  uebernahme: 'Vor dem Übernehmen der Bearbeitung',
  ueberschreiben: 'Vor dem Übernehmen einer lokalen Fassung',
  wiederherstellen: 'Vor dem Wiederherstellen einer älteren Fassung',
  korrektur: 'Vor dem Übernehmen einer Korrektur',
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
