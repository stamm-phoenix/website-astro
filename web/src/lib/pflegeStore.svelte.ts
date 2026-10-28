import { errorMessage, fetchApi } from './api';
import type { StaffProblemMeldungenData } from './problemMelden';
import type {
  AnwesenheitOverview,
  BeitraegeData,
  KostenstellenData,
  OffeneBeitraegeData,
  CampflowBelegeData,
  MitgliederData,
  ProtokollEditorOverview,
  SammelAktion,
  StaffAktionenData,
  StaffBeleg,
  StaffBlogListItem,
  StaffDownload,
  StaffGruppenstundenData,
  StaffLeitendeData,
  StaffNikolausSteuerung,
  StaffEssenSteuerung,
  StaffProtokolleData,
  StaffQuestionsData,
  PersonenUebersicht,
} from './types';

interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** When the data was last loaded successfully (epoch milliseconds). */
  loadedAt: number | null;
}

export interface LoadOptions<P> {
  /** Reloads even if data is already present and starts a new request instead of joining one. */
  force?: boolean;
  /** Passed to the URL builder of the resource, e.g. a date. */
  param?: P;
  /** Reloads data older than this many milliseconds; it stays shown until the answer is there. */
  maxAge?: number;
}

export interface Resource<T, P = void> {
  state: ResourceState<T>;
  /**
   * Loads the data; a newer load always wins over an older answer still in flight, and the
   * promise of a replaced load settles with the newer one.
   */
  load: (options?: LoadOptions<P>) => Promise<void>;
  /**
   * Marks the data as outdated, e.g. after it was changed on another page: the next load asks
   * the server again, and the data stays shown until the answer is there.
   */
  invalidate: () => void;
  /**
   * Shows the view a write answered with; a load still in flight was asked before the write and
   * must not bring the old data back.
   */
  set: (data: T) => void;
}

interface ResourceOptions {
  /** Starts as not loading, for data that is only loaded on request (default: loading). */
  idle?: boolean;
  /** Shown when loading fails and the error has no message of its own. */
  loadError?: string;
}

const LOAD_FAILED =
  'Die Daten konnten nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.';

/**
 * A store for data from the API. Loads without `force` are skipped when data is present and
 * join a running request for the same URL; `endpoint` may build the URL from `param`.
 */
export function createResource<T, P = void>(
  endpoint: string | ((param: P) => string),
  { idle = false, loadError = LOAD_FAILED }: ResourceOptions = {}
): Resource<T, P> {
  const state = $state<ResourceState<T>>({
    data: null,
    loading: !idle,
    error: null,
    loadedAt: null,
  });
  let latest = 0;
  let pending: { url: string; promise: Promise<void>; revision: number } | null = null;
  /** Counts `invalidate` calls; the shown data is current while it matches `loadedRevision`. */
  let revision = 0;
  let loadedRevision = 0;

  function load({ force = false, param, maxAge }: LoadOptions<P> = {}): Promise<void> {
    const expired =
      maxAge !== undefined && (state.loadedAt === null || Date.now() - state.loadedAt >= maxAge);
    const outdated = loadedRevision !== revision;
    if (state.data !== null && !force && !outdated && !expired) return Promise.resolve();
    const url = typeof endpoint === 'string' ? endpoint : endpoint(param as P);
    // A request started before the data was marked as outdated may answer with the old data
    if (!force && pending?.url === url && pending.revision === revision) return pending.promise;

    const id = ++latest;
    const started = revision;
    state.loading = true;
    state.error = null;
    const promise = (async () => {
      try {
        const data = await fetchApi<T>(url);
        if (id === latest) {
          state.data = data;
          state.loadedAt = Date.now();
          loadedRevision = started;
        }
      } catch (error: unknown) {
        if (id === latest) {
          state.error = errorMessage(error, loadError);
        }
      }
      // A replaced load settles together with the newer one, so callers see its result
      if (id !== latest) return pending?.promise;
      pending = null;
      state.loading = false;
    })();
    pending = { url, promise, revision: started };
    return promise;
  }

  function invalidate(): void {
    revision++;
  }

  function set(data: T): void {
    latest++;
    pending = null;
    state.data = data;
    state.loadedAt = Date.now();
    state.error = null;
    state.loading = false;
    loadedRevision = revision;
  }

  return { state, load, invalidate, set };
}

export const gruppenstundenPflege = createResource<StaffGruppenstundenData>(
  '/intern/pflege/gruppenstunden'
);
export const leitendePflege = createResource<StaffLeitendeData>('/intern/pflege/leitende');
export const downloadsPflege = createResource<StaffDownload[]>('/intern/pflege/downloads');
export const blogPflege = createResource<StaffBlogListItem[]>('/intern/pflege/blog');
export const faqPflege = createResource<StaffQuestionsData>('/intern/pflege/qa');
export const aktionenPflege = createResource<StaffAktionenData>('/intern/pflege/aktionen');
export const belegePflege = createResource<StaffBeleg[]>('/intern/pflege/belege');
export const protokollePflege = createResource<StaffProtokolleData>('/intern/pflege/protokolle');
export const personenPflege = createResource<PersonenUebersicht>('/intern/pflege/personen');
/** The Gruppenstunden with their recorded Termine; loaded again on every visit. */
export const anwesenheitOverview = createResource<AnwesenheitOverview>('/intern/anwesenheit', {
  loadError:
    'Die Anwesenheit konnte nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.',
});
/** The minutes written in the editor; loaded again on every visit (who is writing changes). */
export const protokollEditorOverview = createResource<ProtokollEditorOverview>(
  '/intern/protokoll-editor',
  {
    loadError:
      'Die Protokolle konnten nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.',
  }
);
/** All Sammelbestellungen; loaded again on every visit. */
export const sammelCampaigns = createResource<SammelAktion[]>('/intern/pflege/sammelbestellungen', {
  loadError:
    'Die Sammelbestellungen konnten nicht geladen werden. Prüfe deine Internetverbindung und lade die Seite neu.',
});
export const nikolausSteuerung = createResource<StaffNikolausSteuerung>(
  '/intern/nikolaus/steuerung'
);

/** Steuerung of the Essensplanung, only for the teams Admin and Vorstand. */
export const essensplanungSteuerung = createResource<StaffEssenSteuerung>(
  '/intern/essensplanung/steuerung'
);

/** All receipts in CampFlow, read-only; `true` as param has them read from CampFlow again. */
export const campflowBelegeStore = createResource<CampflowBelegeData, boolean>(
  (refresh) =>
    refresh ? '/intern/pflege/belege/campflow?refresh=true' : '/intern/pflege/belege/campflow',
  {
    idle: true,
    loadError:
      'Die Belege aus CampFlow konnten nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.',
  }
);

/** CampFlow's Beiträge, read-only; `true` as param has them read from CampFlow again. */
export const beitraegeStore = createResource<BeitraegeData, boolean>(
  (refresh) => (refresh ? '/intern/beitraege?refresh=true' : '/intern/beitraege'),
  { idle: true }
);

/** Sums per Kostenstelle and Kategorie, read-only; `true` as param exports CampFlow's report again. */
export const kostenstellenStore = createResource<KostenstellenData, boolean>(
  (refresh) =>
    refresh ? '/intern/kostenstellen/summen?refresh=true' : '/intern/kostenstellen/summen',
  {
    idle: true,
    loadError:
      'Die Kostenstellen konnten nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.',
  }
);

/** The Beiträge with something left to do and which of them are the own ones, for the start page. */
export const offeneBeitraegeStore = createResource<OffeneBeitraegeData>('/intern/beitraege/meine', {
  idle: true,
  loadError:
    'Deine Beiträge konnten nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.',
});

/** The CampFlow member list with its groups, read-only; `true` as param reads CampFlow again. */
export const mitgliederStore = createResource<MitgliederData, boolean>(
  (refresh) => (refresh ? '/intern/mitglieder?refresh=true' : '/intern/mitglieder'),
  {
    idle: true,
    loadError:
      'Die Mitgliederliste konnte nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.',
  }
);

/** The Problemmeldungen of „Problem melden“; loaded again on every visit. */
export const problemmeldungenPflege = createResource<StaffProblemMeldungenData>(
  '/intern/pflege/problemmeldungen',
  {
    loadError:
      'Die Problemmeldungen konnten nicht geladen werden. Prüfe deine Internetverbindung und lade die Meldungen noch einmal.',
  }
);
