import { z } from 'zod';

/** Requests counted in the current UTC hour and day, as stored for a shared budget. */
export interface RequestBudget {
  hour: number;
  hourCount: number;
  day: number;
  dayCount: number;
}

const counter = z.int().min(0);
const storedBudget = z.object({
  hour: counter,
  hourCount: counter,
  day: counter,
  dayCount: counter,
});

/**
 * Reads a stored budget at `now`: `undefined` if nothing is stored yet, so the budget starts
 * empty. A counter of an earlier hour or day starts over. Returns `null` for a damaged value,
 * and for one of a window that is still to come (a request that waited for the lock across the
 * hour must not reset the newer window), so the caller must not guess a budget then.
 */
export function readRequestBudget(value: unknown, now: number): RequestBudget | null {
  const hour = Math.floor(now / 3_600_000);
  const day = Math.floor(now / 86_400_000);
  if (value === undefined) return { hour, hourCount: 0, day, dayCount: 0 };
  const stored = storedBudget.safeParse(value);
  if (!stored.success || stored.data.hour > hour || stored.data.day > day) return null;
  return {
    hour,
    day,
    hourCount: stored.data.hour === hour ? stored.data.hourCount : 0,
    dayCount: stored.data.day === day ? stored.data.dayCount : 0,
  };
}
