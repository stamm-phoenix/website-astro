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

  gruppenstundenStore.loading = true;
  gruppenstundenStore.error = false;

  fetchPromise = (async () => {
    try {
      const data = await fetchApi<Gruppenstunde[]>('/gruppenstunden');
      gruppenstundenStore.data = data.sort(
        (a, b) => (STUFE_ORDER[a.stufe] ?? 99) - (STUFE_ORDER[b.stufe] ?? 99)
      );
    } catch {
      gruppenstundenStore.error = true;
    } finally {
      fetchPromise = null;
      gruppenstundenStore.loading = false;
    }
  })();

  return fetchPromise;
}
