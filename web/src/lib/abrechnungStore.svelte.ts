import { untrack } from 'svelte';
import { ABRECHNUNG_STORAGE_PREFIX, storedLoeschdatum } from './abrechnungAblage';
import { localDate } from './dateUtils';
import { ApiError, errorMessage, fetchApi } from './api';
import type { LeihgebuehrEingabe } from './abrechnungRechnung';
import { isKjrBetreuer, kjrHerkunft } from './kjrZuschuss';
import { ortFuerPlz } from './plzOrte.svelte';
import type { Abrechnung, AbrechnungPerson, Kostenstelle } from './types';

interface StoreError {
  message: string;
  code?: string;
}

interface AbrechnungState {
  /** Per `<event id>|<Kostenstelle>`; an empty Kostenstelle means the one derived from the event. */
  data: Record<string, Abrechnung>;
  /** Keys currently loading. */
  loading: Record<string, boolean>;
  errors: Record<string, StoreError>;
}

interface KostenstellenState {
  data: Kostenstelle[] | null;
  loading: boolean;
  error: string | null;
}

export const abrechnungStore = $state<AbrechnungState>({ data: {}, loading: {}, errors: {} });

export const kostenstellenStore = $state<KostenstellenState>({
  data: null,
  loading: false,
  error: null,
});

function toStoreError(error: unknown): StoreError {
  return {
    message: errorMessage(
      error,
      'Die Daten konnten nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.'
    ),
    code: error instanceof ApiError ? error.code : undefined,
  };
}

export function abrechnungKey(id: string, kostenstelle = ''): string {
  return `${id}|${kostenstelle}`;
}

const pending: Record<string, Promise<void>> = {};

/**
 * Loads the overview of an Aktion; cached per Aktion and Kostenstelle unless `force` is set.
 * `refresh` also has the Einzelnachweise exported from CampFlow again instead of the last export.
 */
export function fetchAbrechnung(
  id: string,
  kostenstelle = '',
  { force = false, refresh = false }: { force?: boolean; refresh?: boolean } = {}
): Promise<void> {
  const key = abrechnungKey(id, kostenstelle);
  if (abrechnungStore.data[key] && !force && !refresh) return Promise.resolve();
  const running = pending[key];
  if (running) return running;

  abrechnungStore.loading[key] = true;
  delete abrechnungStore.errors[key];

  const params = [
    ...(kostenstelle ? [`kostenstelle=${encodeURIComponent(kostenstelle)}`] : []),
    ...(refresh ? ['refresh=true'] : []),
  ];
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  const promise = (async () => {
    try {
      abrechnungStore.data[key] = await fetchApi<Abrechnung>(
        `/intern/abrechnung/${encodeURIComponent(id)}${query}`
      );
    } catch (error: unknown) {
      abrechnungStore.errors[key] = toStoreError(error);
      if (error instanceof ApiError && error.code === 'KOSTENSTELLE_NOT_FOUND') {
        void fetchKostenstellen();
      }
    } finally {
      delete pending[key];
      delete abrechnungStore.loading[key];
    }
  })();
  pending[key] = promise;
  return promise;
}

let kostenstellenPromise: Promise<void> | null = null;

/** Loads all Kostenstellen from CampFlow, to pick one when the Aktion's title matches none. */
export function fetchKostenstellen({ force = false }: { force?: boolean } = {}): Promise<void> {
  if (kostenstellenStore.data && !force) return Promise.resolve();
  if (kostenstellenPromise) return kostenstellenPromise;

  kostenstellenStore.loading = true;
  kostenstellenStore.error = null;

  kostenstellenPromise = (async () => {
    try {
      kostenstellenStore.data = await fetchApi<Kostenstelle[]>('/intern/abrechnung/kostenstellen');
    } catch (error: unknown) {
      kostenstellenStore.error = toStoreError(error).message;
    } finally {
      kostenstellenPromise = null;
      kostenstellenStore.loading = false;
    }
  })();
  return kostenstellenPromise;
}

/**
 * What is changed on the page of an Aktion. Kept on this device per Aktion (see
 * `storeAbrechnungSession`), so it survives leaving the page, a reload and closing the tab; only
 * when the browser refuses to store it, it lasts as long as the page is open.
 */
export interface AbrechnungSession {
  zusatztag: boolean;
  /** CampFlow person IDs left out of the Abrechnung. */
  excluded: Record<string, true>;
  /** Persons added on the page. */
  extra: AbrechnungPerson[];
  /** Persons under 27 entered as Betreuer*in, by ID; from 27 on everyone is one anyway. */
  betreuer: Record<string, true>;
  /** Postleitzahlen entered on the page instead of CampFlow's, by person ID (raw input). */
  plz: Record<string, string>;
  /** Header of the KJR's Teilnahmeliste that CampFlow does not know. */
  kjr: { ort: string; plz: string; beginn: string; ende: string };
  /** Material borrowed from the Stamm, by `id` of the material in `Abrechnung.leihgebuehren`. */
  leihgebuehren: Record<string, LeihgebuehrEingabe>;
  /** Names on the Deckblatt. */
  deckblatt: { vorkalkulation: string; kalkulation: string };
  /** Amounts of Einzelnachweise changed on the page, in cent, by `NachweisZeile.key`. */
  betraege: Record<string, number>;
}

/** Whether the session of an Aktion is kept on this device, and since when. */
export interface AbrechnungAblage {
  /** False once the browser refused to read or store it (private mode, blocked, full). */
  available: boolean;
  /** ISO time of the change this device still keeps; `null` while nothing is stored. */
  savedAt: string | null;
  /** Last day (`YYYY-MM-DD`) the stored entries are kept; `null` while nothing is stored. */
  deleteAfter: string | null;
}

export const abrechnungSessions = $state<Record<string, AbrechnungSession>>({});
export const abrechnungAblage = $state<Record<string, AbrechnungAblage>>({});

const STORAGE_KEY = ABRECHNUNG_STORAGE_PREFIX;
/** Last JSON of each session read from or written to storage, to skip unchanged writes. */
const storedJson: Record<string, string> = {};

function emptySession(): AbrechnungSession {
  return {
    zusatztag: false,
    excluded: {},
    extra: [],
    betreuer: {},
    plz: {},
    kjr: { ort: '', plz: '', beginn: '', ende: '' },
    leihgebuehren: {},
    deckblatt: { vorkalkulation: '', kalkulation: '' },
    betraege: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The entries of a stored object that fit, converted by `pick` (`undefined` drops one). */
function pickEntries<T>(
  value: unknown,
  pick: (entry: unknown) => T | undefined
): Record<string, T> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const picked = pick(entry);
      return picked === undefined ? [] : [[key, picked] as const];
    })
  );
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function trueOnly(value: unknown): true | undefined {
  return value === true ? true : undefined;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

const GENDERS = ['m', 'w', 'd', ''] as const;
const HERKUNFT = ['landkreis', 'stadt', 'andere', 'unbekannt'] as const;

/** A person added on the page, as stored; `null` if it does not fit. */
function parsePerson(value: unknown): AbrechnungPerson | null {
  if (!isRecord(value)) return null;
  const { id, lastName, firstName, gender, age, plz, ort, herkunft, betreuer } = value;
  const validGender = GENDERS.find((g) => g === gender);
  const validHerkunft = HERKUNFT.find((h) => h === herkunft);
  if (
    typeof id !== 'string' ||
    !id.startsWith('extra-') ||
    typeof lastName !== 'string' ||
    typeof firstName !== 'string' ||
    validGender === undefined ||
    !(age === null || isCount(age)) ||
    typeof plz !== 'string' ||
    !(ort === undefined || typeof ort === 'string') ||
    validHerkunft === undefined ||
    typeof betreuer !== 'boolean'
  ) {
    return null;
  }
  return {
    id,
    lastName,
    firstName,
    gender: validGender,
    age,
    plz,
    ...(ort === undefined ? {} : { ort }),
    herkunft: validHerkunft,
    betreuer,
  };
}

function parseLeihgebuehr(value: unknown): LeihgebuehrEingabe | undefined {
  if (!isRecord(value)) return undefined;
  const { count, days } = value;
  return isCount(count) && (days === null || isCount(days)) ? { count, days } : undefined;
}

/** Rebuilds a stored session; fields that do not fit are left empty instead. */
function parseSession(value: unknown): AbrechnungSession {
  if (!isRecord(value)) return emptySession();
  const kjr = isRecord(value.kjr) ? value.kjr : {};
  const deckblatt = isRecord(value.deckblatt) ? value.deckblatt : {};
  return {
    zusatztag: value.zusatztag === true,
    excluded: pickEntries(value.excluded, trueOnly),
    extra: Array.isArray(value.extra)
      ? value.extra.map(parsePerson).filter((p): p is AbrechnungPerson => p !== null)
      : [],
    betreuer: pickEntries(value.betreuer, trueOnly),
    plz: pickEntries(value.plz, (entry) => (typeof entry === 'string' ? entry : undefined)),
    kjr: {
      ort: pickString(kjr.ort),
      plz: pickString(kjr.plz),
      beginn: pickString(kjr.beginn),
      ende: pickString(kjr.ende),
    },
    leihgebuehren: pickEntries(value.leihgebuehren, parseLeihgebuehr),
    deckblatt: {
      vorkalkulation: pickString(deckblatt.vorkalkulation),
      kalkulation: pickString(deckblatt.kalkulation),
    },
    betraege: pickEntries(value.betraege, (entry) =>
      typeof entry === 'number' && Number.isInteger(entry) ? entry : undefined
    ),
  };
}

interface StoredSession {
  session: AbrechnungSession;
  savedAt: string;
  deleteAfter: string;
}

/** Reads what this device kept for an Aktion; anything that does not fit counts as nothing. */
function readStored(eventId: string): { available: boolean; stored: StoredSession | null } {
  let raw: string | null;
  try {
    raw = localStorage.getItem(`${STORAGE_KEY}${eventId}`);
  } catch {
    return { available: false, stored: null };
  }
  if (!raw) return { available: true, stored: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    const deleteAfter = storedLoeschdatum(parsed);
    if (
      !isRecord(parsed) ||
      typeof parsed.savedAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.savedAt)) ||
      deleteAfter === null
    ) {
      return { available: true, stored: null };
    }
    if (deleteAfter < localDate()) {
      // Kept until one month after the KJR deadline (abrechnungAblage.ts)
      localStorage.removeItem(`${STORAGE_KEY}${eventId}`);
      return { available: true, stored: null };
    }
    const session = parseSession(parsed.session);
    return {
      available: true,
      stored: abrechnungSessionChanged(session)
        ? { session, savedAt: parsed.savedAt, deleteAfter }
        : null,
    };
  } catch {
    return { available: true, stored: null };
  }
}

/** The session of an Aktion, restored from this device or created empty on first use. */
export function abrechnungSession(eventId: string): AbrechnungSession {
  if (!abrechnungSessions[eventId]) {
    const { available, stored } = readStored(eventId);
    abrechnungSessions[eventId] = stored?.session ?? emptySession();
    abrechnungAblage[eventId] = {
      available,
      savedAt: stored?.savedAt ?? null,
      deleteAfter: stored?.deleteAfter ?? null,
    };
    storedJson[eventId] = JSON.stringify(abrechnungSessions[eventId]);
  }
  return abrechnungSessions[eventId];
}

/**
 * Keeps the session of an Aktion on this device with the time of the change until `deleteAfter`,
 * or removes it when nothing is entered. Waits while the deletion day is not known yet (`null`,
 * before the Aktion is loaded). Reads the whole session, so calling it in an `$effect` stores
 * every change.
 */
export function storeAbrechnungSession(eventId: string, deleteAfter: string | null): void {
  const session = abrechnungSessions[eventId];
  if (!session) return;
  const json = JSON.stringify(session);
  untrack(() => {
    const ablage = (abrechnungAblage[eventId] ??= {
      available: true,
      savedAt: null,
      deleteAfter: null,
    });
    // Unchanged entries are written again only when the Aktion's dates moved their last day
    const sameEntries = storedJson[eventId] === json;
    if (sameEntries && (ablage.savedAt === null || ablage.deleteAfter === deleteAfter)) return;
    const changed = abrechnungSessionChanged(session);
    if (changed && deleteAfter === null) return;
    if (changed && deleteAfter !== null && deleteAfter < localDate()) {
      // Past its last day: the entries stay in memory only, and what this device kept goes
      if (ablage.savedAt === null) return;
      try {
        localStorage.removeItem(`${STORAGE_KEY}${eventId}`);
        ablage.savedAt = null;
        ablage.deleteAfter = null;
      } catch {
        ablage.available = false;
      }
      return;
    }
    // A plain timestamp, not reactive state
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const savedAt = changed ? (sameEntries ? ablage.savedAt : new Date().toISOString()) : null;
    try {
      const key = `${STORAGE_KEY}${eventId}`;
      if (changed) localStorage.setItem(key, JSON.stringify({ savedAt, deleteAfter, session }));
      else localStorage.removeItem(key);
      storedJson[eventId] = json;
      ablage.available = true;
      ablage.savedAt = savedAt;
      ablage.deleteAfter = changed ? deleteAfter : null;
    } catch {
      // Blocked or full: the entries stay in memory while the page is open. An older stored
      // entry stays too, so `savedAt` is kept and resetting can try to remove it again.
      ablage.available = false;
    }
  });
}

/** A Postleitzahl entered on the page, if it is a valid one. */
export function enteredPlz(session: AbrechnungSession, id: string): string | null {
  const value = session.plz[id]?.trim() ?? '';
  return /^\d{5}$/.test(value) ? value : null;
}

/**
 * Registrations and added persons with the role and Postleitzahl entered on the page, excluded
 * ones included. The Ort is CampFlow's; for a changed Postleitzahl and for added persons it comes
 * from the Postleitzahl (once `loadPlzOrte()` has loaded the table).
 */
export function abrechnungPersonen(
  abrechnung: Abrechnung,
  session: AbrechnungSession
): AbrechnungPerson[] {
  return [...abrechnung.persons, ...session.extra].map((person) => {
    const entered = enteredPlz(session, person.id);
    const plz = entered ?? person.plz;
    const fromPlz = entered !== null || person.id.startsWith('extra-');
    return {
      ...person,
      plz,
      ort: fromPlz ? ortFuerPlz(plz, person.ort) : person.ort,
      herkunft: kjrHerkunft(plz),
      betreuer: isKjrBetreuer(person.age, session.betreuer[person.id] === true),
    };
  });
}

/** Whether anything was entered on the page that would be lost when leaving it. */
export function abrechnungSessionChanged(session: AbrechnungSession): boolean {
  const filled = (value: string): boolean => value.trim() !== '';
  return (
    session.zusatztag ||
    Object.keys(session.excluded).length > 0 ||
    session.extra.length > 0 ||
    Object.keys(session.betreuer).length > 0 ||
    Object.values(session.plz).some(filled) ||
    Object.values(session.kjr).some(filled) ||
    Object.values(session.leihgebuehren).some((e) => e.count > 0 || e.days !== null) ||
    Object.values(session.deckblatt).some(filled) ||
    Object.keys(session.betraege).length > 0
  );
}

/** Whether a `storage` event is about the stored entries of this Aktion. */
export function isAbrechnungStorageKey(eventId: string, key: string | null): boolean {
  return key === `${STORAGE_KEY}${eventId}`;
}

/**
 * Takes over what another tab stored for the Aktion. Without it, the next change in this tab
 * would write its older copy and drop the other tab's entries.
 */
export function adoptStoredAbrechnungSession(eventId: string): void {
  const session = abrechnungSessions[eventId];
  if (!session) return;
  // Entries this tab could not store are only in memory; taking over would drop them
  if (!abrechnungAblage[eventId]?.available && abrechnungSessionChanged(session)) return;
  const { available, stored } = readStored(eventId);
  Object.assign(session, stored?.session ?? emptySession());
  storedJson[eventId] = JSON.stringify(session);
  abrechnungAblage[eventId] = {
    available,
    savedAt: stored?.savedAt ?? null,
    deleteAfter: stored?.deleteAfter ?? null,
  };
}

/**
 * Forgets the session of an Aktion in memory, e.g. after leaving its page. What this device
 * kept stays and is restored on the next visit.
 */
export function resetAbrechnungSession(eventId: string): void {
  delete abrechnungSessions[eventId];
  delete abrechnungAblage[eventId];
  delete storedJson[eventId];
}

/** Clears everything entered for an Aktion, in memory and on this device. */
export function clearAbrechnungSession(eventId: string): void {
  Object.assign(abrechnungSession(eventId), emptySession());
  storeAbrechnungSession(eventId, null);
}
