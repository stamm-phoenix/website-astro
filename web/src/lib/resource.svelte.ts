import { ApiError, errorMessage, fetchApi } from './api';

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** The `code` of the API error behind `error`, if the server sent one. */
  errorCode: string | null;
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
   * Loads the data. It is skipped while the shown data was loaded from the same URL and is
   * neither outdated nor older than `maxAge`. A newer load always wins over an older answer
   * still in flight, and the promise of a replaced load settles with the newer one.
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
  /** Whether data is shown that is not outdated and, with `maxAge`, not older than that. */
  isCurrent: (maxAge?: number) => boolean;
}

/** A resource whose server keeps a copy of external data and can be told to read it again. */
export interface RefreshableResource<T, P = void> extends Resource<T, P> {
  /** Starts a new request that has the server read the external data again. */
  refresh: (param?: P) => Promise<void>;
}

export interface ResourceOptions<T, R = T> {
  /** Starts as not loading, for data that is only loaded on request (default: loading). */
  idle?: boolean;
  /** Shown when loading fails and the error has no message of its own. */
  loadError?: string;
  /** Turns the answer into the data that is shown, e.g. sorts it. */
  transform?: (answer: R) => T;
  /** Adds `refresh()`, which loads the URL with `refresh=true` appended. */
  refreshable?: boolean;
}

export const LOAD_FAILED =
  'Die Daten konnten nicht geladen werden. Prüfe deine Internetverbindung und tippe auf „Erneut versuchen“.';

export function emptyState<T>(loading: boolean): ResourceState<T> {
  return { data: null, loading, error: null, errorCode: null, loadedAt: null };
}

/** `url` with `refresh=true`, which has the server read CampFlow again instead of its last read. */
export function refreshUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}refresh=true`;
}

interface LoadRequest {
  /** What the data is of; a load of another identity never counts as the data being current. */
  identity: string;
  /** What is requested; differs from `identity` for a refresh, which asks for the same data. */
  url: string;
  force?: boolean;
  maxAge?: number;
}

interface Cell<T> {
  load: (request: LoadRequest) => Promise<void>;
  invalidate: () => void;
  set: (data: T) => void;
  isCurrent: (maxAge?: number) => boolean;
}

/**
 * The loading rules of one piece of data, working on the reactive `state` it is given: abort of
 * replaced requests, joining a running request, revisions for `invalidate` and `set`, `maxAge`.
 */
export function createCell<T, R = T>(
  state: ResourceState<T>,
  { loadError = LOAD_FAILED, transform }: Pick<ResourceOptions<T, R>, 'loadError' | 'transform'>
): Cell<T> {
  let latest = 0;
  let running: AbortController | null = null;
  let pending: { identity: string; promise: Promise<void>; revision: number } | null = null;
  /** Counts `invalidate` calls; the shown data is current while it matches `loadedRevision`. */
  let revision = 0;
  let loadedRevision = 0;
  /** What the shown data was loaded from; `null` for data that only `set` has shown. */
  let loadedIdentity: string | null = null;

  function isCurrent(maxAge?: number): boolean {
    const expired =
      maxAge !== undefined && (state.loadedAt === null || Date.now() - state.loadedAt >= maxAge);
    return state.data !== null && loadedRevision === revision && !expired;
  }

  function load({ identity, url, force = false, maxAge }: LoadRequest): Promise<void> {
    const sameData = loadedIdentity === null || loadedIdentity === identity;
    if (!force && sameData && isCurrent(maxAge)) return Promise.resolve();
    // A request started before the data was marked as outdated may answer with the old data
    if (!force && pending?.identity === identity && pending.revision === revision) {
      return pending.promise;
    }

    const id = ++latest;
    const started = revision;
    // The request of a replaced load is cancelled, not only ignored
    running?.abort();
    const controller = (running = new AbortController());
    state.loading = true;
    state.error = null;
    state.errorCode = null;
    const promise = (async () => {
      try {
        const answer = await fetchApi<R>(url, controller.signal);
        if (id === latest) {
          state.data = transform ? transform(answer) : (answer as unknown as T);
          state.loadedAt = Date.now();
          loadedRevision = started;
          loadedIdentity = identity;
        }
      } catch (error: unknown) {
        if (id === latest) {
          state.error = errorMessage(error, loadError);
          state.errorCode = (error instanceof ApiError && error.code) || null;
        }
      }
      // A replaced load settles together with the newer one, so callers see its result
      if (id !== latest) return pending?.promise;
      pending = null;
      running = null;
      state.loading = false;
    })();
    pending = { identity, promise, revision: started };
    return promise;
  }

  function invalidate(): void {
    revision++;
  }

  function set(data: T): void {
    latest++;
    running?.abort();
    running = null;
    pending = null;
    state.data = data;
    state.loadedAt = Date.now();
    state.error = null;
    state.errorCode = null;
    state.loading = false;
    loadedRevision = revision;
  }

  return { load, invalidate, set, isCurrent };
}

/**
 * A store for data from the API. Loads without `force` are skipped while the shown data came
 * from the same URL and join a running request for it; `endpoint` may build the URL from `param`.
 */
export function createResource<T, P = void, R = T>(
  endpoint: string | ((param: P) => string),
  options: ResourceOptions<T, R> & { refreshable: true }
): RefreshableResource<T, P>;
export function createResource<T, P = void, R = T>(
  endpoint: string | ((param: P) => string),
  options?: ResourceOptions<T, R>
): Resource<T, P>;
export function createResource<T, P = void, R = T>(
  endpoint: string | ((param: P) => string),
  options: ResourceOptions<T, R> = {}
): Resource<T, P> | RefreshableResource<T, P> {
  const state = $state<ResourceState<T>>(emptyState(!options.idle));
  const cell = createCell<T, R>(state, options);
  const urlOf = (param?: P): string =>
    typeof endpoint === 'string' ? endpoint : endpoint(param as P);

  const resource: Resource<T, P> = {
    state,
    load: ({ param, ...rest } = {}) => {
      const url = urlOf(param);
      return cell.load({ identity: url, url, ...rest });
    },
    invalidate: cell.invalidate,
    set: cell.set,
    isCurrent: cell.isCurrent,
  };
  if (!options.refreshable) return resource;
  return {
    ...resource,
    refresh: (param) => {
      const identity = urlOf(param);
      return cell.load({ identity, url: refreshUrl(identity), force: true });
    },
  };
}
