import type { Gruppenstunde } from './types';
import { fetchApi } from './api';
import { STUFE_ORDER } from './types';

interface GruppenstundenStoreState {
  data: Gruppenstunde[] | null;
  loading: boolean;
  error: boolean;
}

export const gruppenstundenStore = $state<GruppenstundenStoreState>({
  data: null,
  loading: true,
  error: false,
});

let fetchPromise: Promise<void> | null = null;

export function fetchGruppenstunden(): Promise<void> {
  if (fetchPromise) return fetchPromise;
  if (gruppenstundenStore.data !== null) return Promise.resolve();

  gruppenstundenStore.loading = true;
  gruppenstundenStore.error = false;

  fetchPromise = (async () => {
    try {
      const data = await fetchApi<Gruppenstunde[]>('/gruppenstunden');
      gruppenstundenStore.data = data.sort(
        (a, b) => (STUFE_ORDER[a.stufe] ?? 99) - (STUFE_ORDER[b.stufe] ?? 99)
      );
      gruppenstundenStore.loading = false;
    } catch {
      fetchPromise = null;
      gruppenstundenStore.error = true;
      gruppenstundenStore.loading = false;
    }
  })();

  return fetchPromise;
}
