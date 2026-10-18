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
