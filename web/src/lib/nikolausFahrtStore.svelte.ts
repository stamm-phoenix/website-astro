import { fetchApi } from './api';
import type { StaffNikolausFahrtData, StaffNikolausFahrtVisit } from './types';

interface NikolausFahrtStoreState {
  data: StaffNikolausFahrtData | null;
  loading: boolean;
  error: boolean;
}

export const nikolausFahrtStore = $state<NikolausFahrtStoreState>({
  data: null,
  loading: false,
  error: false,
});

let requestId = 0;

/**
 * Loads the routes of a day; older answers are ignored. A `silent` refresh (while on the
 * road) keeps the shown data if it fails, so a dead spot does not empty the page.
 */
export async function fetchNikolausFahrt(
  date: string,
  { silent = false }: { silent?: boolean } = {}
): Promise<boolean> {
  const current = ++requestId;
  if (!silent) {
    nikolausFahrtStore.loading = true;
    nikolausFahrtStore.error = false;
  }
  try {
    const data = await fetchApi<StaffNikolausFahrtData>(
      `/intern/nikolaus/fahrt?date=${encodeURIComponent(date)}`
    );
    if (current === requestId) {
      nikolausFahrtStore.data = data;
      nikolausFahrtStore.error = false;
    }
    return true;
  } catch {
    if (current === requestId && !silent) nikolausFahrtStore.error = true;
    return false;
  } finally {
    if (current === requestId) nikolausFahrtStore.loading = false;
  }
}

/**
 * Takes over a saved visit. Answers of requests started before are ignored, as they would
 * bring back the old state.
 */
export function applyNikolausVisit(visit: StaffNikolausFahrtVisit): void {
  requestId++;
  nikolausFahrtStore.loading = false;
  for (const route of Object.values(nikolausFahrtStore.data?.routes ?? {})) {
    const stop = route.find((s) => s.bookingId === visit.bookingId);
    if (stop) {
      stop.visited = visit.visited;
      stop.visitedAt = visit.visitedAt;
    }
  }
}
