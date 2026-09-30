import type { Leitende } from './types';
import { fetchApi } from './api';

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

  leitendeStore.loading = true;
  leitendeStore.error = false;

  fetchPromise = (async () => {
    try {
      leitendeStore.data = await fetchApi<Leitende[]>('/leitende');
    } catch {
      leitendeStore.error = true;
    } finally {
      fetchPromise = null;
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
