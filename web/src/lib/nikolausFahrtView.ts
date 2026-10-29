import type { StaffNikolausFahrtStop } from './types';
export function mergeStops(
  stops: StaffNikolausFahrtStop[],
  pending: Record<string, boolean>,
  queue: { bookingId: string; visited: boolean; status: string }[]
): StaffNikolausFahrtStop[] {
  const queued = new Map(
    queue.filter((entry) => entry.status === 'pending').map((entry) => [entry.bookingId, entry])
  );
  return stops.map((stop) => {
    if (stop.bookingId in pending) return { ...stop, visited: pending[stop.bookingId] };
    const entry = queued.get(stop.bookingId);
    return entry ? { ...stop, visited: entry.visited, visitedAt: '' } : stop;
  });
}
export { formatClock as formatTime } from './format';

const TEAM_STORAGE_KEY = 'nikolaus-fahrt-team';

/** The team chosen last time on this device. */
export function readStoredTeam(): string | null {
  try {
    return localStorage.getItem(TEAM_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeTeam(name: string): void {
  try {
    localStorage.setItem(TEAM_STORAGE_KEY, name);
  } catch {
    // Only a convenience: the team has to be chosen again next time
  }
}
