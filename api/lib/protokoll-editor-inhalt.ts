/** Limits and helpers for the content of the Protokoll-Editor (types: `protokoll-editor-model.ts`). Free of imports besides the types. */
import type { ProtokollPerson, ProtokollAufgabe, ProtokollProjekt, OffeneAufgabe, ProtokollPunkt, ProtokollKopf, ProtokollNaechsteSitzung, ProtokollInhalt, OffeneAufgabeQuelle } from './protokoll-editor-model';

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
  { titel: 'Aktionsrückblick', unterpunkte: [] },
  { titel: 'Aktionsvorschau', unterpunkte: [] },
  { titel: 'Sonstiges', unterpunkte: [] },
];

/** A new agenda item; `id` must be unique within the minutes. */
export function neuerPunkt(id: string, titel = ''): ProtokollPunkt {
  return {
    id,
    titel,
    aktion: null,
    zeitraum: null,
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
 * or sub-item („Wölflinge“, „Aktionsvorschau“) to its text; `naechsteSitzung` presets the time and place
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
 * `termine` or `offeneAufgaben` becomes an empty list, a missing `projekt` or `zeitraum` `null`, a Sitzungsleitung or Protokoll typed as one string becomes one person
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
    zeitraum: p.zeitraum ?? null,
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
