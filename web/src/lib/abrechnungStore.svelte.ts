import { ApiError, fetchApi } from './api';
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
  return error instanceof ApiError
    ? { message: error.message, code: error.code }
    : { message: 'Die Daten konnten nicht geladen werden.' };
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
 * What is changed on the page of an Aktion. Only kept in memory: it is gone after reloading or
 * leaving the page, like a scratch pad for the Abrechnung.
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
}

export const abrechnungSessions = $state<Record<string, AbrechnungSession>>({});

/** The session of an Aktion, created on first use. */
export function abrechnungSession(eventId: string): AbrechnungSession {
  abrechnungSessions[eventId] ??= {
    zusatztag: false,
    excluded: {},
    extra: [],
    betreuer: {},
    plz: {},
    kjr: { ort: '', plz: '', beginn: '', ende: '' },
    leihgebuehren: {},
    deckblatt: { vorkalkulation: '', kalkulation: '' },
  };
  return abrechnungSessions[eventId];
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
    Object.values(session.deckblatt).some(filled)
  );
}

/** Drops what was entered for an Aktion, e.g. after leaving its page. */
export function resetAbrechnungSession(eventId: string): void {
  delete abrechnungSessions[eventId];
}
