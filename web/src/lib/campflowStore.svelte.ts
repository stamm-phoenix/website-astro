import { ApiError, fetchApi } from './api';
import type { CampflowEvent, CampflowEventDetail } from './types';

interface CampflowEventsState {
  data: CampflowEvent[] | null;
  loading: boolean;
  error: string | null;
}

interface CampflowDetailState {
  data: Record<string, CampflowEventDetail>;
  loading: boolean;
  error: string | null;
}

export const campflowEventsStore = $state<CampflowEventsState>({
  data: null,
  loading: true,
  error: null,
});

export const campflowDetailStore = $state<CampflowDetailState>({
  data: {},
  loading: true,
  error: null,
});

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Die Daten konnten nicht geladen werden.';
}

let eventsPromise: Promise<void> | null = null;

/** Loads all CampFlow events; `force` reloads even if data is already present. */
export function fetchCampflowEvents({ force = false }: { force?: boolean } = {}): Promise<void> {
  if (campflowEventsStore.data && !force) return Promise.resolve();
  if (eventsPromise) return eventsPromise;

  campflowEventsStore.loading = true;
  campflowEventsStore.error = null;

  eventsPromise = (async () => {
    try {
      campflowEventsStore.data = await fetchApi<CampflowEvent[]>('/intern/aktionen');
    } catch (error: unknown) {
      campflowEventsStore.error = errorMessage(error);
    } finally {
      eventsPromise = null;
      campflowEventsStore.loading = false;
    }
  })();

  return eventsPromise;
}

const detailPromises: Record<string, Promise<void>> = {};

/** Loads one event with its participants; cached per event id unless `force` is set. */
export function fetchCampflowEvent(
  id: string,
  { force = false }: { force?: boolean } = {}
): Promise<void> {
  if (campflowDetailStore.data[id] && !force) {
    campflowDetailStore.loading = false;
    return Promise.resolve();
  }
  const pending = detailPromises[id];
  if (pending) return pending;

  campflowDetailStore.loading = true;
  campflowDetailStore.error = null;

  const promise = (async () => {
    try {
      campflowDetailStore.data[id] = await fetchApi<CampflowEventDetail>(
        `/intern/aktionen/${encodeURIComponent(id)}`
      );
    } catch (error: unknown) {
      campflowDetailStore.error = errorMessage(error);
    } finally {
      delete detailPromises[id];
      campflowDetailStore.loading = false;
    }
  })();
  detailPromises[id] = promise;
  return promise;
}
