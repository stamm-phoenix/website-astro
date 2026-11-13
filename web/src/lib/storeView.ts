/** State of a store that loads data from the API (see `*Store.svelte.ts`). */
export interface LoadState<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
}

/**
 * What an island shows: the data loaded in the browser, otherwise the data baked into the page
 * at build time. Loading and error states only appear when nothing was baked, so a failed
 * refresh keeps showing the baked content.
 */
export function withBaked<T>(store: LoadState<T>, baked: T | null | undefined): LoadState<T> {
  if (store.data !== null || baked === null || baked === undefined) return store;
  return { data: baked, loading: false, error: false };
}

/**
 * The `LoadState` view of a resource's state, for the stores the islands read with `withBaked`.
 * With `background`, a reload of data that is already shown reports neither loading nor an
 * error, so the page keeps what it shows instead of flashing a spinner or a message.
 */
export function loadStateOf<T>(
  state: { data: T | null; loading: boolean; error: string | null },
  { background = false }: { background?: boolean } = {}
): LoadState<T> {
  return {
    get data() {
      return state.data;
    },
    get loading() {
      return state.loading && !(background && state.data !== null);
    },
    get error() {
      return state.error !== null && !(background && state.data !== null);
    },
  };
}
