import { errorMessage, fetchApi } from './api';
import type {
  StaffAktionenData,
  StaffBeleg,
  StaffBlogListItem,
  StaffDownload,
  StaffGruppenstundenData,
  StaffLeitendeData,
  StaffNikolausSteuerung,
  StaffProtokolleData,
  StaffQuestionsData,
  WeiterePerson,
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
}

export interface Resource<T, P = void> {
  state: ResourceState<T>;
  /**
   * Loads the data; a newer load always wins over an older answer still in flight, and the
   * promise of a replaced load settles with the newer one.
   */
  load: (options?: LoadOptions<P>) => Promise<void>;
}

interface ResourceOptions {
  /** Starts as not loading, for data that is only loaded on request (default: loading). */
  idle?: boolean;
}

/**
 * A store for data from the API. Loads without `force` are skipped when data is present and
 * join a running request for the same URL; `endpoint` may build the URL from `param`.
 */
export function createResource<T, P = void>(
  endpoint: string | ((param: P) => string),
  { idle = false }: ResourceOptions = {}
): Resource<T, P> {
  const state = $state<ResourceState<T>>({
    data: null,
    loading: !idle,
    error: null,
    loadedAt: null,
  });
  let latest = 0;
  let pending: { url: string; promise: Promise<void> } | null = null;

  function load({ force = false, param }: LoadOptions<P> = {}): Promise<void> {
    if (state.data !== null && !force) return Promise.resolve();
    const url = typeof endpoint === 'string' ? endpoint : endpoint(param as P);
    if (!force && pending?.url === url) return pending.promise;

    const id = ++latest;
    state.loading = true;
    state.error = null;
    const promise = (async () => {
      try {
        const data = await fetchApi<T>(url);
        if (id === latest) {
          state.data = data;
          state.loadedAt = Date.now();
        }
      } catch (error: unknown) {
        if (id === latest) {
          state.error = errorMessage(
            error,
            'Die Daten konnten nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.'
          );
        }
      }
      // A replaced load settles together with the newer one, so callers see its result
      if (id !== latest) return pending?.promise;
      pending = null;
      state.loading = false;
    })();
    pending = { url, promise };
    return promise;
  }

  return { state, load };
}

export const gruppenstundenPflege = createResource<StaffGruppenstundenData>(
  '/intern/pflege/gruppenstunden'
);
export const leitendePflege = createResource<StaffLeitendeData>('/intern/pflege/leitende');
export const downloadsPflege = createResource<StaffDownload[]>('/intern/pflege/downloads');
export const blogPflege = createResource<StaffBlogListItem[]>('/intern/pflege/blog');
export const FAQ_PFLEGE = createResource<StaffQuestionsData>('/intern/pflege/qa');
export const aktionenPflege = createResource<StaffAktionenData>('/intern/pflege/aktionen');
export const belegePflege = createResource<StaffBeleg[]>('/intern/pflege/belege');
export const protokollePflege = createResource<StaffProtokolleData>('/intern/pflege/protokolle');
export const personenPflege = createResource<WeiterePerson[]>('/intern/pflege/personen');
export const nikolausSteuerung = createResource<StaffNikolausSteuerung>(
  '/intern/nikolaus/steuerung'
);
