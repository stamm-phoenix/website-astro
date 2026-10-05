import type { StaffNikolausFahrtData } from './types';

export const FAHRT_STORAGE_KEY = 'nikolaus-fahrt-offline-v1';
export const FAHRT_OWNER_KEY = 'nikolaus-fahrt-owner';
export const FAHRT_TTL_MS = 12 * 60 * 60 * 1000;

export interface FahrtMutation {
  bookingId: string;
  visited: boolean;
  operationId: string;
  version: string;
  slotKey: string;
  status: 'pending' | 'conflict';
}

export interface FahrtSnapshot {
  schema: 1;
  owner: string;
  team: string;
  expiresAt: number;
  savedAt: number;
  data: StaffNikolausFahrtData;
  queue: FahrtMutation[];
}

/** A single selected team, never a local copy of all families or of auth credentials. */
export function ownRoute(data: StaffNikolausFahrtData, team: string): StaffNikolausFahrtData {
  return {
    ...data,
    teams: data.teams.filter((entry) => entry.name === team),
    routes: { [team]: data.routes[team] ?? [] },
    members: { [team]: data.members[team] ?? [] },
  };
}

/** Read an owner-bound snapshot, deleting expired or invalid local data. */
export function readFahrtSnapshot(owner: string): FahrtSnapshot | null {
  try {
    const raw = localStorage.getItem(FAHRT_STORAGE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as FahrtSnapshot;
    if (
      snapshot.schema !== 1 ||
      snapshot.owner !== owner ||
      !Number.isFinite(snapshot.expiresAt) ||
      snapshot.expiresAt <= Date.now() ||
      snapshot.expiresAt > Date.now() + FAHRT_TTL_MS ||
      !Number.isFinite(snapshot.savedAt) ||
      typeof snapshot.team !== 'string' ||
      typeof snapshot.data?.date !== 'string' ||
      !Array.isArray(snapshot.data.teams) ||
      !Array.isArray(snapshot.data.routes?.[snapshot.team]) ||
      Object.keys(snapshot.data.routes).some((team) => team !== snapshot.team) ||
      !Array.isArray(snapshot.queue) ||
      !snapshot.queue.every(
        (entry) =>
          typeof entry.bookingId === 'string' &&
          typeof entry.visited === 'boolean' &&
          typeof entry.operationId === 'string' &&
          typeof entry.version === 'string' &&
          typeof entry.slotKey === 'string' &&
          ['pending', 'conflict'].includes(entry.status)
      )
    ) {
      localStorage.removeItem(FAHRT_STORAGE_KEY);
      return null;
    }
    return snapshot;
  } catch {
    try {
      localStorage.removeItem(FAHRT_STORAGE_KEY);
    } catch {
      /* Storage unavailable. */
    }
    return null;
  }
}
