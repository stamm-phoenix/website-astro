import type { StaffNikolausFahrtStop } from './types';
export function mergeStops(
  stops: StaffNikolausFahrtStop[],
  pending: Record<string, boolean>,
  queue: { bookingId: string; visited: boolean; status: string }[]
): StaffNikolausFahrtStop[] {
  return stops.map((stop) =>
    stop.bookingId in pending
      ? { ...stop, visited: pending[stop.bookingId] }
      : queue.find((entry) => entry.bookingId === stop.bookingId && entry.status === 'pending')
        ? {
            ...stop,
            visited: queue.find((entry) => entry.bookingId === stop.bookingId)!.visited,
            visitedAt: '',
          }
        : stop
  );
}
export { formatClock as formatTime } from './format';
