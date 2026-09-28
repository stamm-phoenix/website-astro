import { fetchApi } from './api';
import type { StaffNikolausEinteilungData, StaffNikolausHelfendeData } from './types';

interface Loadable<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
}

export const helfendeStore = $state<Loadable<StaffNikolausHelfendeData>>({
  data: null,
  loading: false,
  error: false,
});

export const einteilungStore = $state<Loadable<StaffNikolausEinteilungData>>({
  data: null,
  loading: false,
  error: false,
});

async function load<T>(store: Loadable<T>, endpoint: string): Promise<void> {
  store.loading = true;
  store.error = false;
  try {
    store.data = await fetchApi<T>(endpoint);
  } catch {
    store.error = true;
  } finally {
    store.loading = false;
  }
}

/** Loads all helpers with the tags in use and the configured days. */
export function fetchHelfende(): Promise<void> {
  return load(helfendeStore, '/intern/nikolaus/helfende');
}

/** Loads helpers, days with the family tags per team and the saved Einteilung. */
export function fetchEinteilung(): Promise<void> {
  return load(einteilungStore, '/intern/nikolaus/einteilung');
}
