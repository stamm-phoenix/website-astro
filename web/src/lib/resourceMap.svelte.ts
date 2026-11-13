import { createCell, emptyState, refreshUrl } from './resource.svelte';
import type { ResourceOptions, ResourceState } from './resource.svelte';

export interface MapLoadOptions {
  /** Reloads even if data is present and starts a new request instead of joining one. */
  force?: boolean;
  /** Reloads data older than this many milliseconds; it stays shown until the answer is there. */
  maxAge?: number;
}

export interface ResourceMap<T, K> {
  /**
   * The state of every key that was loaded or set, under `keyOf(key)`; a key not asked yet has
   * no entry. Reading a missing entry in a template stays reactive once it appears.
   */
  state: Record<string, ResourceState<T>>;
  /** Loads one key with the same rules as `Resource.load`; keys do not affect each other. */
  load: (key: K, options?: MapLoadOptions) => Promise<void>;
  /** Marks the data of one key as outdated, or of every key without an argument. */
  invalidate: (key?: K) => void;
  /** Shows the view a write answered with, and drops a load of that key still in flight. */
  set: (key: K, data: T) => void;
  /** Whether the key shows data that is not outdated and, with `maxAge`, not older than that. */
  isCurrent: (key: K, maxAge?: number) => boolean;
  /** Forgets everything loaded, so every key starts from nothing again. */
  forget: () => void;
}

/** A keyed resource whose server keeps a copy of external data and can read it again. */
export interface RefreshableResourceMap<T, K> extends ResourceMap<T, K> {
  /** Starts a new request for one key that has the server read the external data again. */
  refresh: (key: K) => Promise<void>;
}

interface ResourceMapOptions<T, K, R = T> extends ResourceOptions<T, R> {
  /** The name of a key in `state`; default `String(key)`. Never use a bare key that can be `__proto__`. */
  keyOf?: (key: K) => string;
}

/**
 * Data per key, e.g. per Aktion or per day, with the loading rules of `createResource` for each
 * key. A load of one key never replaces or aborts a load of another.
 */
export function createResourceMap<T, K = string, R = T>(
  endpoint: (key: K) => string,
  options: ResourceMapOptions<T, K, R> & { refreshable: true }
): RefreshableResourceMap<T, K>;
export function createResourceMap<T, K = string, R = T>(
  endpoint: (key: K) => string,
  options?: ResourceMapOptions<T, K, R>
): ResourceMap<T, K>;
export function createResourceMap<T, K = string, R = T>(
  endpoint: (key: K) => string,
  options: ResourceMapOptions<T, K, R> = {}
): ResourceMap<T, K> | RefreshableResourceMap<T, K> {
  const { keyOf = String } = options;
  const state = $state<Record<string, ResourceState<T>>>({});
  // Loading bookkeeping that is never rendered
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const cells = new Map<string, ReturnType<typeof createCell<T, R>>>();

  function cellOf(key: K): ReturnType<typeof createCell<T, R>> {
    const name = keyOf(key);
    let cell = cells.get(name);
    if (!cell) {
      state[name] = emptyState<T>(false);
      // The proxy of the store, not the object assigned above
      cell = createCell<T, R>(state[name], options);
      cells.set(name, cell);
    }
    return cell;
  }

  const map: ResourceMap<T, K> = {
    state,
    load: (key, { force, maxAge } = {}) => {
      const url = endpoint(key);
      return cellOf(key).load({ identity: url, url, force, maxAge });
    },
    invalidate: (key) => {
      if (key === undefined) for (const cell of cells.values()) cell.invalidate();
      else cells.get(keyOf(key))?.invalidate();
    },
    set: (key, data) => cellOf(key).set(data),
    isCurrent: (key, maxAge) => cells.get(keyOf(key))?.isCurrent(maxAge) ?? false,
    forget: () => {
      // A load still in flight writes to its detached entry, which nothing shows any more
      cells.clear();
      for (const name of Object.keys(state)) delete state[name];
    },
  };
  if (!options.refreshable) return map;
  return {
    ...map,
    refresh: (key) => {
      const identity = endpoint(key);
      return cellOf(key).load({ identity, url: refreshUrl(identity), force: true });
    },
  };
}
