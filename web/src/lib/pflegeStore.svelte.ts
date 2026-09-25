import { ApiError, fetchApi } from './api';
import type { StaffDownload, StaffGruppenstundenData, StaffLeitendeData } from './types';

interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface Resource<T> {
  state: ResourceState<T>;
  /** Loads the data; `force` reloads even if data is already present. */
  load: (options?: { force?: boolean }) => Promise<void>;
}

function createResource<T>(endpoint: string): Resource<T> {
  const state = $state<ResourceState<T>>({ data: null, loading: true, error: null });
  let pending: Promise<void> | null = null;

  function load({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (state.data && !force) return Promise.resolve();
    if (pending) return pending;

    state.loading = true;
    state.error = null;
    pending = (async () => {
      try {
        state.data = await fetchApi<T>(endpoint);
      } catch (error: unknown) {
        state.error =
          error instanceof ApiError ? error.message : 'Die Daten konnten nicht geladen werden.';
      } finally {
        pending = null;
        state.loading = false;
      }
    })();
    return pending;
  }

  return { state, load };
}

export const gruppenstundenPflege = createResource<StaffGruppenstundenData>(
  '/intern/pflege/gruppenstunden'
);
export const leitendePflege = createResource<StaffLeitendeData>('/intern/pflege/leitende');
export const downloadsPflege = createResource<StaffDownload[]>('/intern/pflege/downloads');
