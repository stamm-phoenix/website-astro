// Saving, loading, refreshing, resetting and recovering the personal entries to the Abrechnung of
// an Aktion. The state lives in the Svelte store (`abrechnungStore.svelte.ts`); the rules live here
// and take their state and their network and storage access as arguments, so a unit test can run
// them without a browser, a Svelte runtime or a server.
import { ApiError, errorMessage } from './api';
import { storedLoeschdatum } from './abrechnungAblage';
import { findRescue, forgetRescue, rescueValues } from './geretteteEingaben';
import {
  emptySession,
  parseSession,
  validAbrechnungSession,
} from '../../../api/lib/abrechnung-session';
import type { AbrechnungEingabe, AbrechnungSession } from '../../../api/lib/abrechnung-session';

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

export const KONFLIKT_MELDUNG =
  'Du hast die Eingaben inzwischen auf einem anderen Gerät geändert. Hier wurde nichts überschrieben. Kopiere deine neuen Angaben und lade dann die gespeicherte Fassung.';
export const ANMELDUNG_KONFLIKT_MELDUNG =
  'Die gespeicherten Eingaben wurden während der Anmeldung geändert. Deine geretteten Angaben stehen hier noch ungespeichert. Hier wurde nichts überschrieben. Kopiere sie und lade dann die gespeicherte Fassung.';
const LADEN_FEHLER =
  'Deine gespeicherten Eingaben konnten nicht geladen werden. Prüfe die Verbindung und lade sie erneut.';
const SPEICHERN_FEHLER =
  'Die Eingaben wurden nicht gespeichert. Sie bleiben auf dieser Seite erhalten. Prüfe die Verbindung und tippe noch einmal auf „Eingaben speichern“.';

/** What an older version kept on this device for an Aktion. */
export interface StoredSession {
  session: AbrechnungSession;
  savedAt: string;
  deleteAfter: string;
}

/** The state of the entries of all Aktionen that are open in the browser. */
export interface EingabenRegistry {
  sessions: Record<string, AbrechnungSession>;
  ablage: Record<string, AbrechnungAblage>;
  /** Last JSON of each session as the server has it, to tell changed from unchanged. */
  storedJson: Record<string, string>;
  /** Dialogs open per Aktion whose input is not in the session yet (an amount being typed). */
  openDrafts: Record<string, number>;
  zeitplanZeilen: Record<string, Record<string, string>>;
  zeitplanFreitext: Record<string, string>;
}

/** Network and device storage the rules need. */
export interface EingabenIo {
  fetch(eventId: string): Promise<AbrechnungEingabe>;
  put(
    eventId: string,
    body: { session: AbrechnungSession; etag: string | null }
  ): Promise<AbrechnungEingabe>;
  /** The copy of an older version kept on this device, or `null`. */
  readLegacy(eventId: string): StoredSession | null;
  removeLegacy(eventId: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

/** Whether lines or a description of the Zeitplan were typed and not taken over yet. */
export function offeneZeitplanZeilen(
  registry: Pick<EingabenRegistry, 'zeitplanZeilen' | 'zeitplanFreitext'>,
  eventId: string
): boolean {
  return (
    Object.values(registry.zeitplanZeilen[eventId] ?? {}).some((text) => text.trim() !== '') ||
    !!registry.zeitplanFreitext[eventId]?.trim()
  );
}

/**
 * Reads what this device kept for an Aktion; anything that does not fit counts as nothing, and an
 * entry past its deletion date is removed (kept until one month after the KJR deadline).
 */
export function readLegacyStorage(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  key: string,
  today: string
): { available: boolean; stored: StoredSession | null } {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
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
    if (deleteAfter < today) {
      storage.removeItem(key);
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

/** Reads and removes the copy of an older version kept on this device, under `prefix + eventId`. */
export function legacyZugriff(
  storage: () => Pick<Storage, 'getItem' | 'removeItem'>,
  prefix: string,
  today: () => string
): Pick<EingabenIo, 'readLegacy' | 'removeLegacy'> {
  return {
    readLegacy: (eventId) => {
      try {
        return readLegacyStorage(storage(), `${prefix}${eventId}`, today()).stored;
      } catch {
        return null;
      }
    },
    removeLegacy: (eventId) => storage().removeItem(`${prefix}${eventId}`),
  };
}

/** The state of an Aktion as it is before anything was loaded. */
export function neueAblage(): AbrechnungAblage {
  return {
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
}

/** Loads the entries saved for the account; an older copy of this device is offered as unsaved. */
export async function loadEingaben(
  registry: EingabenRegistry,
  io: EingabenIo,
  eventId: string
): Promise<void> {
  const state = registry.ablage[eventId];
  if (!state || state.saving) return;
  state.error = null;
  try {
    const saved = await io.fetch(eventId);
    const target = registry.sessions[eventId];
    // A page that was left meanwhile must not be filled by its late answer
    if (!target || registry.ablage[eventId] !== state) return;
    const legacy = saved.etag === null ? io.readLegacy(eventId) : null;
    Object.assign(target, legacy?.session ?? saved.session);
    registry.storedJson[eventId] = JSON.stringify(saved.session);
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
    state.error = errorMessage(error, LADEN_FEHLER);
  }
}

/**
 * Asks the server again for the entries of a session kept from an earlier visit, while they stay
 * shown and editable. A newer saved version replaces them only while nothing was changed here and
 * no dialog is open; otherwise the input is kept and the page reports the conflict, as a failed
 * save would. A failed request changes nothing: saving still checks the version.
 */
export async function refreshEingaben(
  registry: EingabenRegistry,
  io: EingabenIo,
  eventId: string
): Promise<void> {
  const state = registry.ablage[eventId];
  if (!state?.loaded || state.saving || state.conflict) return;
  const etag = state.etag;
  let saved: AbrechnungEingabe;
  try {
    saved = await io.fetch(eventId);
  } catch {
    return;
  }
  const target = registry.sessions[eventId];
  // A save, a reset or a newer load meanwhile has a newer answer than this one
  if (!target || registry.ablage[eventId] !== state || state.saving || state.etag !== etag) return;
  if (state.conflict) return;
  if (saved.etag === etag) {
    state.savedAt = saved.savedAt;
    state.deleteAfter = saved.deleteAfter;
    return;
  }
  // Lines typed under „Mehrere Zeilen einfügen“ count as unsaved input: their day must stay
  if (
    !registry.openDrafts[eventId] &&
    !offeneZeitplanZeilen(registry, eventId) &&
    JSON.stringify(target) === registry.storedJson[eventId]
  ) {
    Object.assign(target, saved.session);
    registry.storedJson[eventId] = JSON.stringify(saved.session);
    Object.assign(state, {
      etag: saved.etag,
      savedAt: saved.savedAt,
      deleteAfter: saved.deleteAfter,
      dirty: false,
      error: null,
    });
  } else {
    state.conflict = true;
    state.error = KONFLIKT_MELDUNG;
  }
}

/** Tracks edits; saving is explicit so a failed request never masquerades as a saved change. */
export function markiereEingaben(registry: EingabenRegistry, eventId: string, json?: string): void {
  const session = registry.sessions[eventId];
  if (!session) return;
  const state = registry.ablage[eventId];
  if (!state?.loaded) return;
  state.dirty = (json ?? JSON.stringify(session)) !== registry.storedJson[eventId];
}

/** Saves the submitted entries with the version they build on; `true` once the server has them. */
export async function speichereEingaben(
  registry: EingabenRegistry,
  io: EingabenIo,
  eventId: string,
  submitted: AbrechnungSession = registry.sessions[eventId]
): Promise<boolean> {
  const state = registry.ablage[eventId];
  if (!state?.loaded || state.saving || state.conflict) return false;
  const json = JSON.stringify(submitted);
  state.saving = true;
  state.error = null;
  try {
    const saved = await io.put(eventId, { session: JSON.parse(json), etag: state.etag });
    // A request from a discarded page must not update a newly opened session.
    if (registry.ablage[eventId] !== state) return false;
    registry.storedJson[eventId] = json;
    state.etag = saved.etag;
    state.savedAt = saved.savedAt;
    state.deleteAfter = saved.deleteAfter;
    state.available = true;
    state.dirty = JSON.stringify(registry.sessions[eventId]) !== json;
    // The old device-only copy is removed only after a confirmed save.
    try {
      io.removeLegacy(eventId);
    } catch {
      /* Server copy is saved. */
    }
    return true;
  } catch (error) {
    state.conflict = error instanceof ApiError && [409, 412].includes(error.status);
    state.error = state.conflict ? KONFLIKT_MELDUNG : errorMessage(error, SPEICHERN_FEHLER);
    return false;
  } finally {
    state.saving = false;
  }
}

/**
 * Clears everything entered for an Aktion. The editable draft stays intact until the reset is
 * confirmed; edits made during the request survive a successful reset and stay marked unsaved.
 */
export async function leereEingaben(
  registry: EingabenRegistry,
  io: EingabenIo,
  eventId: string
): Promise<boolean> {
  const state = registry.ablage[eventId];
  if (state?.saving || state?.conflict) return false;
  const session = registry.sessions[eventId];
  const before = JSON.stringify(session);
  const saved = await speichereEingaben(registry, io, eventId, emptySession());
  if (saved && JSON.stringify(session) === before) Object.assign(session, emptySession());
  markiereEingaben(registry, eventId);
  return saved;
}

/** Rescues the entire personal draft before a login in the same window, scoped to account and Aktion. */
export function rescueEingaben(
  registry: EingabenRegistry,
  eventId: string,
  userId: string,
  title: string
): boolean {
  const state = registry.ablage[eventId];
  const session = registry.sessions[eventId];
  if (!state?.loaded || state.saving || !session) return false;
  return rescueValues(`abrechnung:${userId}:${eventId}`, title, state.etag ?? '', [
    {
      key: 'Abrechnung#custom',
      kind: 'custom',
      value: JSON.stringify({
        session,
        etag: state.etag,
        zeilen: registry.zeitplanZeilen[eventId] ?? {},
        freitext: registry.zeitplanFreitext[eventId] ?? '',
      }),
      display: 'Deine persönlichen Ergänzungen zur Abrechnung',
    },
  ]);
}

/** Restores locally; a changed server version requires an explicit conflict decision before saving. */
export function stelleEingabenWiederHer(
  registry: EingabenRegistry,
  eventId: string,
  userId: string,
  now: number = Date.now()
): boolean {
  const state = registry.ablage[eventId];
  const session = registry.sessions[eventId];
  if (!state?.loaded || state.saving || !session) return false;
  const record = `abrechnung:${userId}:${eventId}`;
  const kept = findRescue(record, null, now)?.find((field) => field.key === 'Abrechnung#custom');
  if (!kept) return false;
  try {
    const draft = JSON.parse(kept.value) as {
      session: unknown;
      etag: unknown;
      zeilen?: unknown;
      freitext?: unknown;
    };
    if (
      !validAbrechnungSession(draft.session) ||
      !(draft.etag === null || typeof draft.etag === 'string')
    )
      return false;
    Object.assign(session, parseSession(draft.session));
    if (typeof draft.freitext === 'string' && draft.freitext.trim())
      registry.zeitplanFreitext[eventId] = draft.freitext;
    if (isRecord(draft.zeilen)) {
      registry.zeitplanZeilen[eventId] = Object.fromEntries(
        Object.entries(draft.zeilen).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      );
    }
    state.dirty = JSON.stringify(session) !== registry.storedJson[eventId];
    if (draft.etag !== state.etag) {
      // Keep the draft's base version even across a second login, so repeated recovery
      // can never turn a known conflict into permission to overwrite the server.
      state.etag = draft.etag;
      state.conflict = true;
      state.error = ANMELDUNG_KONFLIKT_MELDUNG;
    }
    forgetRescue(record);
    return true;
  } catch {
    return false;
  }
}
