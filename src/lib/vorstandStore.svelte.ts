import type { Vorstand } from "./types";
import { fetchApi } from "./api";

interface VorstandStoreState {
  data: Vorstand[] | null;
  loading: boolean;
  error: boolean;
}

export const vorstandStore = $state<VorstandStoreState>({
  data: null,
  loading: true,
  error: false,
});

let fetchPromise: Promise<void> | null = null;

export function fetchVorstand(): Promise<void> {
  if (fetchPromise) return fetchPromise;
  if (vorstandStore.data !== null) return Promise.resolve();

  vorstandStore.loading = true;
  vorstandStore.error = false;

  fetchPromise = (async () => {
    try {
      vorstandStore.data = await fetchApi<Vorstand[]>("/vorstand");
      vorstandStore.loading = false;
    } catch {
      fetchPromise = null;
      vorstandStore.error = true;
      vorstandStore.loading = false;
    }
  })();

  return fetchPromise;
}
