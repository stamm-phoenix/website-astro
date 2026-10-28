import { rescueValues, findRescue, forgetRescue } from './geretteteEingaben';
import { untrack } from 'svelte';
import { ABRECHNUNG_STORAGE_PREFIX, storedLoeschdatum } from './abrechnungAblage';
import { localDate } from './dateUtils';
import { ApiError, errorMessage, fetchApi, sendApi } from './api';
import {
  emptySession,
  parseSession,
  validAbrechnungSession,
} from '../../../api/lib/abrechnung-session';
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
/** Counts the loads; only the latest sets the store, so a late answer cannot undo a newer one. */
let kostenstellenRequest = 0;

/**
 * Loads all Kostenstellen from CampFlow, to pick one when the Aktion's title matches none. The
 * Playwright API answers with its last read; `refresh` has it read CampFlow again.
 */
export function fetchKostenstellen({
  force = false,
  refresh = false,
}: { force?: boolean; refresh?: boolean } = {}): Promise<void> {
  if (kostenstellenStore.data && !force && !refresh) return Promise.resolve();
  if (kostenstellenPromise && !refresh) return kostenstellenPromise;

  kostenstellenStore.loading = true;
  kostenstellenStore.error = null;

  const request = ++kostenstellenRequest;
  kostenstellenPromise = (async () => {
    try {
      const data = await fetchApi<Kostenstelle[]>(
        refresh ? '/intern/kostenstellen?refresh=true' : '/intern/kostenstellen'
      );
      if (request === kostenstellenRequest) kostenstellenStore.data = data;
    } catch (error: unknown) {
      if (request === kostenstellenRequest) kostenstellenStore.error = toStoreError(error).message;
    } finally {
      if (request === kostenstellenRequest) {
        kostenstellenPromise = null;
        kostenstellenStore.loading = false;
      }
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
/**
 * Lines typed under „Mehrere Zeilen einfügen“ of the Kurzbeschreibung and not taken over yet, by
 * Aktion and day. Kept here so they survive a change of tab, and guarded like unsaved entries.
 */
export const zeitplanZeilen = $state<Record<string, Record<string, string>>>({});

export function offeneZeitplanZeilen(eventId: string): boolean {
  return Object.values(zeitplanZeilen[eventId] ?? {}).some((text) => text.trim() !== '');
}
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

/** Dialogs open per Aktion whose input is not in the session yet, such as an amount being typed. */
const openDrafts: Record<string, number> = {};

/**
 * Marks a dialog of the Aktion as open until the returned function is called. Its input builds on
 * the shown version, so a newer one saved meanwhile counts as a conflict instead of replacing it.
 */
export function holdAbrechnungDraft(eventId: string): () => void {
  openDrafts[eventId] = (openDrafts[eventId] ?? 0) + 1;
  let held = true;
  return () => {
    if (held) openDrafts[eventId]--;
    held = false;
  };
}

const CONFLICT_MESSAGE =
  'Du hast die Eingaben inzwischen auf einem anderen Gerät geändert. Hier wurde nichts überschrieben. Kopiere deine neuen Angaben und lade dann die gespeicherte Fassung.';

/**
 * Asks the server again for the entries of a session kept from an earlier visit, while they stay
 * shown and editable. A newer saved version replaces them only while nothing was changed here and
 * no dialog is open; otherwise the input is kept and the page reports the conflict, as a failed
 * save would.
 * A failed request changes nothing: saving still checks the version.
 */
export async function refreshAbrechnungSession(eventId: string): Promise<void> {
  const state = abrechnungAblage[eventId];
  if (!state?.loaded || state.saving || state.conflict) return;
  const etag = state.etag;
  let saved: AbrechnungEingabe;
  try {
    saved = await fetchApi<AbrechnungEingabe>(
      `/intern/abrechnung/${encodeURIComponent(eventId)}/eingaben`
    );
  } catch {
    return;
  }
  const target = abrechnungSessions[eventId];
  // A save, a reset or a newer load meanwhile has a newer answer than this one
  if (!target || abrechnungAblage[eventId] !== state || state.saving || state.etag !== etag) return;
  if (state.conflict) return;
  if (saved.etag === etag) {
    state.savedAt = saved.savedAt;
    state.deleteAfter = saved.deleteAfter;
    return;
  }
  // Lines typed under „Mehrere Zeilen einfügen“ count as unsaved input: their day must stay
  if (
    !openDrafts[eventId] &&
    !offeneZeitplanZeilen(eventId) &&
    JSON.stringify(target) === storedJson[eventId]
  ) {
    Object.assign(target, saved.session);
    storedJson[eventId] = JSON.stringify(saved.session);
    Object.assign(state, {
      etag: saved.etag,
      savedAt: saved.savedAt,
      deleteAfter: saved.deleteAfter,
      dirty: false,
      error: null,
    });
  } else {
    state.conflict = true;
    state.error = CONFLICT_MESSAGE;
  }
}

/**
 * Whether the session of an Aktion can stay in memory after leaving its page, to be shown at once
 * on the next visit: only one that is loaded and has nothing unsaved, failed or running.
 */
export function abrechnungSessionReusable(eventId: string): boolean {
  const state = abrechnungAblage[eventId];
  return (
    !!state &&
    state.loaded &&
    !state.dirty &&
    !state.saving &&
    !state.conflict &&
    state.error === null &&
    JSON.stringify(abrechnungSessions[eventId]) === storedJson[eventId]
  );
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
      ? CONFLICT_MESSAGE
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
    Object.keys(session.betraege).length > 0 ||
    filled(session.kurzbeschreibung.einleitung) ||
    // Days changed by hand, even without blocks, can be reset
    session.kurzbeschreibung.tage.length > 0
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

/** Rescue the entire personal draft before same-window login, scoped to its account and Aktion. */
export function rescueAbrechnungSession(eventId: string, userId: string, title: string): boolean {
  const state = abrechnungAblage[eventId];
  const session = abrechnungSessions[eventId];
  if (!state?.loaded || state.saving || !session) return false;
  return rescueValues(`abrechnung:${userId}:${eventId}`, title, state.etag ?? '', [
    {
      key: 'Abrechnung#custom',
      kind: 'custom',
      value: JSON.stringify({ session, etag: state.etag, zeilen: zeitplanZeilen[eventId] ?? {} }),
      display: 'Deine persönlichen Ergänzungen zur Abrechnung',
    },
  ]);
}

/** Restore locally; a changed server version requires an explicit conflict decision before saving. */
export function restoreAbrechnungRescue(eventId: string, userId: string): boolean {
  const state = abrechnungAblage[eventId];
  const session = abrechnungSessions[eventId];
  if (!state?.loaded || state.saving || !session) return false;
  const record = `abrechnung:${userId}:${eventId}`;
  const kept = findRescue(record, null, Date.now())?.find(
    (field) => field.key === 'Abrechnung#custom'
  );
  if (!kept) return false;
  try {
    const draft = JSON.parse(kept.value) as { session: unknown; etag: unknown; zeilen?: unknown };
    if (
      !validAbrechnungSession(draft.session) ||
      !(draft.etag === null || typeof draft.etag === 'string')
    )
      return false;
    Object.assign(session, parseSession(draft.session));
    if (isRecord(draft.zeilen)) {
      zeitplanZeilen[eventId] = Object.fromEntries(
        Object.entries(draft.zeilen).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      );
    }
    state.dirty = JSON.stringify(session) !== storedJson[eventId];
    if (draft.etag !== state.etag) {
      // Keep the draft's base version even across a second login, so repeated recovery
      // can never turn a known conflict into permission to overwrite the server.
      state.etag = draft.etag;
      state.conflict = true;
      state.error =
        'Die gespeicherten Eingaben wurden während der Anmeldung geändert. Deine geretteten Angaben stehen hier noch ungespeichert. Hier wurde nichts überschrieben. Kopiere sie und lade dann die gespeicherte Fassung.';
    }
    forgetRescue(record);
    return true;
  } catch {
    return false;
  }
}

/**
 * Forgets the loaded Abrechnungen, so the next visit loads them again with the own registrations
 * (`ich`). Entries made on the page are kept apart and stay.
 */
export function forgetAbrechnungen(): void {
  for (const key of Object.keys(abrechnungStore.data)) delete abrechnungStore.data[key];
}
