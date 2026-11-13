import { untrack } from 'svelte';
import { ABRECHNUNG_STORAGE_PREFIX } from './staffStorageKeys';
import {
  legacyZugriff,
  leereEingaben,
  loadEingaben,
  markiereEingaben,
  neueAblage,
  offeneZeitplanZeilen as offeneZeilen,
  refreshEingaben,
  rescueEingaben,
  speichereEingaben,
  stelleEingabenWiederHer,
} from './abrechnungEingaben';
import type { AbrechnungAblage, EingabenIo, EingabenRegistry } from './abrechnungEingaben';
import { localDate } from './dateUtils';
import { fetchApi, sendApi } from './api';
import { createResource } from './resource.svelte';
import { createResourceMap } from './resourceMap.svelte';
import { emptySession } from '../../../api/lib/abrechnung-session';
import type { AbrechnungEingabe } from '../../../api/lib/abrechnung-session';
import type { AbrechnungSession } from '../../../api/lib/abrechnung-session';
export type { AbrechnungSession } from '../../../api/lib/abrechnung-session';
import { isKjrBetreuer, kjrHerkunft } from './kjrZuschuss';
import { ortFuerPlz } from './plzOrte.svelte';
import type { Abrechnung } from './types/abrechnung';
import type { AbrechnungPerson } from '../../../api/lib/abrechnung';
import type { Kostenstelle } from '../../../api/lib/kostenstellen-model';

const LOAD_ERROR =
  'Die Daten konnten nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.';

export function abrechnungKey(id: string, kostenstelle = ''): string {
  return `${id}|${kostenstelle}`;
}

interface AbrechnungRequest {
  id: string;
  kostenstelle: string;
}

/** Per `<event id>|<Kostenstelle>`; an empty Kostenstelle means the one derived from the event. */
export const abrechnungen = createResourceMap<Abrechnung, AbrechnungRequest>(
  ({ id, kostenstelle }) =>
    `/intern/abrechnung/${encodeURIComponent(id)}${
      kostenstelle ? `?kostenstelle=${encodeURIComponent(kostenstelle)}` : ''
    }`,
  {
    refreshable: true,
    loadError: LOAD_ERROR,
    keyOf: ({ id, kostenstelle }) => abrechnungKey(id, kostenstelle),
  }
);

/** The shown state of each Abrechnung under its `abrechnungKey`; an Abrechnung not asked for has none. */
export const abrechnungStore = abrechnungen.state;

/** The Abrechnungen loaded so far, to update the Aktion they show when it changes elsewhere. */
export function loadedAbrechnungen(): Abrechnung[] {
  return Object.values(abrechnungStore).flatMap((state) => (state.data ? [state.data] : []));
}

/**
 * Loads the overview of an Aktion; cached per Aktion and Kostenstelle unless `force` is set.
 * `refresh` also has the Einzelnachweise exported from CampFlow again instead of the last export.
 * A call with `force` or `refresh` never joins a running load, which may have read older data;
 * it starts its own, and only the newest load of a key sets the store.
 */
export async function fetchAbrechnung(
  id: string,
  kostenstelle = '',
  { force = false, refresh = false }: { force?: boolean; refresh?: boolean } = {}
): Promise<void> {
  const request = { id, kostenstelle };
  await (refresh ? abrechnungen.refresh(request) : abrechnungen.load(request, { force }));
  const state = abrechnungStore[abrechnungKey(id, kostenstelle)];
  if (state?.errorCode === 'KOSTENSTELLE_NOT_FOUND') void fetchKostenstellen();
}

/** All Kostenstellen from CampFlow, to pick one when the Aktion's title matches none. */
const kostenstellenResource = createResource<Kostenstelle[]>('/intern/kostenstellen', {
  idle: true,
  refreshable: true,
  loadError: LOAD_ERROR,
});
export const kostenstellenStore = kostenstellenResource.state;

/**
 * Loads all Kostenstellen from CampFlow, to pick one when the Aktion's title matches none. The
 * Playwright API answers with its last read; `refresh` has it read CampFlow again.
 */
export function fetchKostenstellen({
  force = false,
  refresh = false,
}: { force?: boolean; refresh?: boolean } = {}): Promise<void> {
  return refresh ? kostenstellenResource.refresh() : kostenstellenResource.load({ force });
}

/**
 * Personal changes to an Aktion. Explicitly saved in Azure SQL per account and restored
 * on every device. Browser storage is only read to recover drafts from older versions.
 * The rules (load, save, refresh, reset, recovery) are in `abrechnungEingaben.ts`; this file
 * holds the reactive state and connects them to the network and the browser.
 */
export { abrechnungSessionChanged } from './abrechnungEingaben';
export type { AbrechnungAblage } from './abrechnungEingaben';

export const abrechnungSessions = $state<Record<string, AbrechnungSession>>({});
/**
 * Lines typed under „Mehrere Zeilen einfügen“ of the Kurzbeschreibung and not taken over yet, by
 * Aktion and day. Kept here so they survive a change of tab, and guarded like unsaved entries.
 */
export const zeitplanZeilen = $state<Record<string, Record<string, string>>>({});

/** The description of the Zeitplan typed but not sent yet, by Aktion; kept and guarded likewise. */
export const zeitplanFreitext = $state<Record<string, string>>({});
export const abrechnungAblage = $state<Record<string, AbrechnungAblage>>({});

const STORAGE_KEY = ABRECHNUNG_STORAGE_PREFIX;
/** Last JSON of each session read from or written to storage, to skip unchanged writes. */
const storedJson: Record<string, string> = {};
/** Dialogs open per Aktion whose input is not in the session yet, such as an amount being typed. */
const openDrafts: Record<string, number> = {};

const registry: EingabenRegistry = {
  sessions: abrechnungSessions,
  ablage: abrechnungAblage,
  storedJson,
  openDrafts,
  zeitplanZeilen,
  zeitplanFreitext,
};

function eingabenUrl(eventId: string): string {
  return `/intern/abrechnung/${encodeURIComponent(eventId)}/eingaben`;
}

const io: EingabenIo = {
  fetch: (eventId) => fetchApi<AbrechnungEingabe>(eingabenUrl(eventId)),
  put: (eventId, body) => sendApi<AbrechnungEingabe>('PUT', eingabenUrl(eventId), body),
  ...legacyZugriff(() => localStorage, STORAGE_KEY, localDate),
};

/** Whether lines or a description of the Zeitplan were typed and not taken over yet. */
export function offeneZeitplanZeilen(eventId: string): boolean {
  return offeneZeilen(registry, eventId);
}

/** Same-account entries are loaded before controls are shown; old local data is offered as an unsaved draft. */
export function abrechnungSession(eventId: string): AbrechnungSession {
  if (!abrechnungSessions[eventId]) {
    abrechnungSessions[eventId] = emptySession();
    abrechnungAblage[eventId] = neueAblage();
    void loadAbrechnungSession(eventId);
  }
  return abrechnungSessions[eventId];
}

export function loadAbrechnungSession(eventId: string): Promise<void> {
  return loadEingaben(registry, io, eventId);
}

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

/** Asks the server again for the entries of a session kept from an earlier visit. */
export function refreshAbrechnungSession(eventId: string): Promise<void> {
  return refreshEingaben(registry, io, eventId);
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
  // Reading the session here, outside untrack, makes a calling effect run again on every edit
  const json = JSON.stringify(session);
  untrack(() => markiereEingaben(registry, eventId, json));
}

export function saveAbrechnungSession(
  eventId: string,
  submitted: AbrechnungSession = abrechnungSessions[eventId]
): Promise<boolean> {
  return speichereEingaben(registry, io, eventId, submitted);
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
export function clearAbrechnungSession(eventId: string): Promise<boolean> {
  if (abrechnungAblage[eventId]?.saving || abrechnungAblage[eventId]?.conflict) {
    return Promise.resolve(false);
  }
  abrechnungSession(eventId);
  return leereEingaben(registry, io, eventId);
}

/** Rescue the entire personal draft before same-window login, scoped to its account and Aktion. */
export function rescueAbrechnungSession(eventId: string, userId: string, title: string): boolean {
  return rescueEingaben(registry, eventId, userId, title);
}

/** Restore locally; a changed server version requires an explicit conflict decision before saving. */
export function restoreAbrechnungRescue(eventId: string, userId: string): boolean {
  return stelleEingabenWiederHer(registry, eventId, userId);
}

/**
 * Forgets the loaded Abrechnungen, so the next visit loads them again with the own registrations
 * (`ich`). Entries made on the page are kept apart and stay.
 */
export function forgetAbrechnungen(): void {
  abrechnungen.forget();
}
