import { untrack } from 'svelte';
import { ABRECHNUNG_STORAGE_PREFIX, storedLoeschdatum } from './abrechnungAblage';
import { localDate } from './dateUtils';
import { ApiError, errorMessage, fetchApi, sendApi } from './api';
import { emptySession, parseSession } from '../../../api/lib/abrechnung-session';
import type { AbrechnungEingabe } from '../../../api/lib/abrechnung-session';
import type { AbrechnungSession } from '../../../api/lib/abrechnung-session';
export type { AbrechnungSession } from '../../../api/lib/abrechnung-session';
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
 * Personal changes to an Aktion. Explicitly saved in Azure SQL per account and restored
 * on every device. Browser storage is only read to recover drafts from older versions.
 */
/** Whether the account draft is loaded, changed, saving or confirmed. */
export interface AbrechnungAblage {
  available: boolean;
  loaded: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  conflict: boolean;
  etag: string | null;
  savedAt: string | null;
  deleteAfter: string | null;
}

export const abrechnungSessions = $state<Record<string, AbrechnungSession>>({});
export const abrechnungAblage = $state<Record<string, AbrechnungAblage>>({});

const STORAGE_KEY = ABRECHNUNG_STORAGE_PREFIX;
/** Last JSON of each session read from or written to storage, to skip unchanged writes. */
const storedJson: Record<string, string> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

/** Same-account entries are loaded before controls are shown; old local data is offered as an unsaved draft. */
export function abrechnungSession(eventId: string): AbrechnungSession {
  if (!abrechnungSessions[eventId]) {
    abrechnungSessions[eventId] = emptySession();
    abrechnungAblage[eventId] = {
      available: false,
      loaded: false,
      saving: false,
      dirty: false,
      error: null,
      conflict: false,
      etag: null,
      savedAt: null,
      deleteAfter: null,
    };
    void loadAbrechnungSession(eventId);
  }
  return abrechnungSessions[eventId];
}

export async function loadAbrechnungSession(eventId: string): Promise<void> {
  const state = abrechnungAblage[eventId];
  if (!state || state.saving) return;
  state.error = null;
  try {
    const saved = await fetchApi<AbrechnungEingabe>(
      `/intern/abrechnung/${encodeURIComponent(eventId)}/eingaben`
    );
    const target = abrechnungSessions[eventId];
    if (!target || abrechnungAblage[eventId] !== state) return;
    const legacy = saved.etag === null ? readStored(eventId).stored : null;
    Object.assign(target, legacy?.session ?? saved.session);
    storedJson[eventId] = JSON.stringify(saved.session);
    Object.assign(state, {
      loaded: true,
      available: true,
      etag: saved.etag,
      savedAt: saved.savedAt,
      deleteAfter: saved.deleteAfter,
      dirty: !!legacy,
      conflict: false,
    });
  } catch (error) {
    state.error = errorMessage(
      error,
      'Deine gespeicherten Eingaben konnten nicht geladen werden. Prüfe die Verbindung und lade sie erneut.'
    );
  }
}

/** Tracks edits; saving is explicit so a failed request never masquerades as a saved change. */
export function storeAbrechnungSession(eventId: string): void {
  const session = abrechnungSessions[eventId];
  if (!session) return;
  const json = JSON.stringify(session);
  untrack(() => {
    const state = abrechnungAblage[eventId];
    if (!state?.loaded) return;
    state.dirty = json !== storedJson[eventId];
  });
}

export async function saveAbrechnungSession(
  eventId: string,
  submitted: AbrechnungSession = abrechnungSessions[eventId]
): Promise<boolean> {
  const state = abrechnungAblage[eventId];
  if (!state?.loaded || state.saving || state.conflict) return false;
  const json = JSON.stringify(submitted);
  state.saving = true;
  state.error = null;
  try {
    const saved = await sendApi<AbrechnungEingabe>(
      'PUT',
      `/intern/abrechnung/${encodeURIComponent(eventId)}/eingaben`,
      { session: JSON.parse(json), etag: state.etag }
    );
    // A request from a discarded page must not update a newly opened session.
    if (abrechnungAblage[eventId] !== state) return false;
    storedJson[eventId] = json;
    state.etag = saved.etag;
    state.savedAt = saved.savedAt;
    state.deleteAfter = saved.deleteAfter;
    state.available = true;
    state.dirty = JSON.stringify(abrechnungSessions[eventId]) !== json;
    // The old device-only copy is removed only after a confirmed save.
    try {
      localStorage.removeItem(`${STORAGE_KEY}${eventId}`);
    } catch {
      /* Server copy is saved. */
    }
    return true;
  } catch (error) {
    state.conflict = error instanceof ApiError && [409, 412].includes(error.status);
    state.error = state.conflict
      ? 'Du hast die Eingaben inzwischen auf einem anderen Gerät geändert. Hier wurde nichts überschrieben. Kopiere deine neuen Angaben und lade dann die gespeicherte Fassung.'
      : errorMessage(
          error,
          'Die Eingaben wurden nicht gespeichert. Sie bleiben auf dieser Seite erhalten. Prüfe die Verbindung und tippe noch einmal auf „Eingaben speichern“.'
        );
    return false;
  } finally {
    state.saving = false;
  }
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
export async function clearAbrechnungSession(eventId: string): Promise<boolean> {
  if (abrechnungAblage[eventId]?.saving || abrechnungAblage[eventId]?.conflict) return false;
  const session = abrechnungSession(eventId);
  const before = JSON.stringify(session);
  // Keep the editable draft intact until the reset has been confirmed. New edits made
  // during the request also survive a successful reset and remain marked unsaved.
  const saved = await saveAbrechnungSession(eventId, emptySession());
  if (saved && JSON.stringify(session) === before) Object.assign(session, emptySession());
  storeAbrechnungSession(eventId);
  return saved;
}
