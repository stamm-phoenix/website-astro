import type { Leitende } from "./types";
import { fetchApi } from "./api";

interface LeitendeStoreState {
  data: Leitende[] | null;
  loading: boolean;
  error: boolean;
}

export const leitendeStore = $state<LeitendeStoreState>({
  data: null,
  loading: true,
  error: false,
});

let fetchPromise: Promise<void> | null = null;

export function fetchLeitende(): Promise<void> {
  if (fetchPromise) return fetchPromise;
  if (leitendeStore.data !== null) return Promise.resolve();

  leitendeStore.loading = true;
  leitendeStore.error = false;

  fetchPromise = (async () => {
    try {
      leitendeStore.data = await fetchApi<Leitende[]>("/leitende");
      leitendeStore.loading = false;
    } catch {
      fetchPromise = null;
      leitendeStore.error = true;
      leitendeStore.loading = false;
    }
  })();

  return fetchPromise;
}

export function getLeadersForGroup(groupKey: string): string[] {
  if (!leitendeStore.data) return [];
  return leitendeStore.data
    .filter((member) => member.teams.includes(groupKey))
    .map((member) => member.name);
}
