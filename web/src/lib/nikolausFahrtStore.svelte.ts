import { ApiError, fetchApi, sendApi } from './api';
import { authStore, fetchPrincipal } from './authStore.svelte';
import {
  FAHRT_OWNER_KEY,
  FAHRT_STORAGE_KEY,
  FAHRT_TTL_MS,
  ownRoute,
  readFahrtSnapshot,
} from './nikolausFahrtOffline';
import type { FahrtMutation, FahrtSnapshot } from './nikolausFahrtOffline';
import type {
  StaffNikolausFahrtData,
  StaffNikolausFahrtStop,
  StaffNikolausFahrtVisit,
} from './types';

interface NikolausFahrtStoreState {
  data: StaffNikolausFahrtData | null;
  dataSource: 'snapshot' | 'server' | null;
  loading: boolean;
  error: boolean;
  offline: boolean;
  snapshot: FahrtSnapshot | null;
  syncing: boolean;
  storageError: string | null;
  lastSync: number | null;
}

export const nikolausFahrtStore = $state<NikolausFahrtStoreState>({
  data: null,
  dataSource: null,
  loading: false,
  error: false,
  offline: false,
  snapshot: null,
  syncing: false,
  storageError: null,
  lastSync: null,
});

let owner: string | null = null;
let requestId = 0;
let initializing: Promise<void> | null = null;
const LOCK = FAHRT_STORAGE_KEY;

/** Resolve the authenticated owner once; network failures allow same-tab offline restore. */
async function initialize(): Promise<void> {
  initializing ??= (async () => {
    await fetchPrincipal();
    const principal = authStore.principal;
    if (principal?.identityProvider === 'aad' && principal.userRoles.includes('authenticated')) {
      owner = principal.userId;
      try {
        sessionStorage.setItem(FAHRT_OWNER_KEY, owner);
      } catch {
        /* Offline restore unavailable. */
      }
    } else if (authStore.error) {
      // Same tab only. A successful anonymous/auth denial never permits fallback.
      try {
        owner = sessionStorage.getItem(FAHRT_OWNER_KEY);
      } catch {
        owner = null;
      }
    } else {
      clearIdentity();
    }
    if (owner) nikolausFahrtStore.snapshot = readFahrtSnapshot(owner);
  })();
  await initializing;
}

/** Remove private route data when authentication is denied. */
function clearIdentity(): void {
  owner = null;
  try {
    sessionStorage.removeItem(FAHRT_OWNER_KEY);
    localStorage.removeItem(FAHRT_STORAGE_KEY);
  } catch {
    /* Storage unavailable. */
  }
  nikolausFahrtStore.snapshot = null;
  nikolausFahrtStore.data = null;
  nikolausFahrtStore.dataSource = null;
}

/** Persist the snapshot before exposing queued changes; report storage failures to the user. */
function persist(snapshot: FahrtSnapshot): boolean {
  try {
    const serialized = JSON.stringify(snapshot);
    localStorage.setItem(FAHRT_STORAGE_KEY, serialized);
    nikolausFahrtStore.snapshot = JSON.parse(serialized) as FahrtSnapshot;
    nikolausFahrtStore.storageError = null;
    return true;
  } catch {
    nikolausFahrtStore.storageError =
      'Die Änderung konnte nicht auf diesem Gerät gespeichert werden. Bitte den Besuch erneut markieren.';
    return false;
  }
}

/** Reads the shared outbox again under the browser lock (including updates from other tabs). */
function currentSnapshot(): FahrtSnapshot | null {
  const snapshot = owner ? readFahrtSnapshot(owner) : null;
  if (!snapshot && nikolausFahrtStore.dataSource === 'snapshot') {
    nikolausFahrtStore.data = null;
    nikolausFahrtStore.dataSource = null;
  }
  nikolausFahrtStore.snapshot = snapshot;
  return snapshot;
}

/** Serialize shared outbox reads and writes across browser tabs. */
async function locked<T>(action: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request(LOCK, action);
  return action();
}

/** Save only the selected team with a fixed expiry after confirming online access. */
export async function saveNikolausRoute(team: string): Promise<void> {
  await initialize();
  await locked(async () => {
    const data = nikolausFahrtStore.data;
    if (!owner || !data || nikolausFahrtStore.offline || !navigator.locks) {
      nikolausFahrtStore.storageError =
        'Zum Speichern brauchst du eine bestätigte Anmeldung, eine Verbindung und einen Browser mit Unterstützung für Offline-Änderungen.';
      return;
    }
    const existing = currentSnapshot();
    if (existing?.queue.length) {
      nikolausFahrtStore.storageError =
        'Bitte zuerst ausstehende Markierungen abgleichen oder verwerfen.';
      return;
    }
    persist({
      schema: 1,
      owner,
      team,
      expiresAt: Date.now() + FAHRT_TTL_MS,
      savedAt: Date.now(),
      data: ownRoute(data, team),
      queue: [],
    });
  });
}

/** Delete the local route and outbox while retaining independently loaded server data. */
export async function forgetNikolausRoute(): Promise<void> {
  await locked(async () => {
    requestId++;
    try {
      localStorage.removeItem(FAHRT_STORAGE_KEY);
    } catch {
      /* Storage unavailable. */
    }
    nikolausFahrtStore.snapshot = null;
    if (nikolausFahrtStore.dataSource === 'snapshot') {
      nikolausFahrtStore.data = null;
      nikolausFahrtStore.dataSource = null;
    }
    nikolausFahrtStore.storageError = null;
  });
}

/** Apply the server-confirmed visit state to matching stops in the displayed or saved route. */
function applyVisit(visit: StaffNikolausFahrtVisit, data: StaffNikolausFahrtData | null): void {
  for (const route of Object.values(data?.routes ?? {})) {
    const stop = route.find((entry) => entry.bookingId === visit.bookingId);
    if (stop) Object.assign(stop, visit);
  }
}

/** Send one versioned visit with its stable retry ID and a bounded request timeout. */
async function transmit(date: string, mutation: FahrtMutation): Promise<StaffNikolausFahrtVisit> {
  return sendApi(
    'POST',
    `/intern/pflege/nikolaus-fahrt?date=${encodeURIComponent(date)}`,
    {
      bookingId: mutation.bookingId,
      visited: mutation.visited,
      operationId: mutation.operationId,
      version: mutation.version,
      slotKey: mutation.slotKey,
    },
    { signal: AbortSignal.timeout(15_000) }
  );
}

/** Serial replay uses stable IDs and conditional server writes; lost responses are safe to retry. */
async function flush(snapshot: FahrtSnapshot): Promise<void> {
  nikolausFahrtStore.syncing = true;
  try {
    for (const mutation of [...snapshot.queue]) {
      if (mutation.status === 'conflict') continue;
      if (snapshot.expiresAt <= Date.now()) {
        currentSnapshot();
        break;
      }
      try {
        const saved = await transmit(snapshot.data.date, mutation);
        applyVisit(saved, snapshot.data);
        if (nikolausFahrtStore.data?.date === snapshot.data.date)
          applyVisit(saved, nikolausFahrtStore.data);
        snapshot.queue = snapshot.queue.filter(
          (entry) => entry.operationId !== mutation.operationId
        );
        // Never send the next change if acknowledging this one cannot be persisted.
        if (!persist(snapshot)) break;
      } catch (error: unknown) {
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          clearIdentity();
          break;
        }
        if (error instanceof ApiError && [400, 404, 409].includes(error.status)) {
          mutation.status = 'conflict';
          if (!persist(snapshot)) break;
          continue;
        }
        nikolausFahrtStore.offline = true;
        break; // Network, timeout or maintenance: keep the exact mutation for the next attempt.
      }
    }
  } finally {
    nikolausFahrtStore.syncing = false;
  }
}

/** Restore a matching local route, replay pending visits, then refresh from the server. */
export async function fetchNikolausFahrt(
  date: string,
  { silent = false }: { silent?: boolean } = {}
): Promise<boolean> {
  const current = ++requestId;
  if (!silent) nikolausFahrtStore.loading = true;
  try {
    await initialize();
    return await locked(async () => {
      const snapshot = currentSnapshot();
      if (current !== requestId) return false;
      if (snapshot?.data.date === date && nikolausFahrtStore.data?.date !== date) {
        nikolausFahrtStore.data = snapshot.data;
        nikolausFahrtStore.dataSource = 'snapshot';
        nikolausFahrtStore.offline = true;
        nikolausFahrtStore.lastSync = snapshot.savedAt;
      }
      if (snapshot && navigator.onLine) await flush(snapshot);
      if (current !== requestId) return false;
      try {
        const data = await fetchApi<StaffNikolausFahrtData>(
          `/intern/nikolaus/fahrt?date=${encodeURIComponent(date)}`,
          AbortSignal.timeout(15_000)
        );
        if (current !== requestId) return false;
        nikolausFahrtStore.data = data;
        nikolausFahrtStore.dataSource = 'server';
        nikolausFahrtStore.error = false;
        nikolausFahrtStore.offline = false;
        nikolausFahrtStore.lastSync = Date.now();
        if (snapshot?.data.date === date && owner && snapshot.expiresAt > Date.now()) {
          snapshot.data = ownRoute(data, snapshot.team);
          snapshot.savedAt = Date.now();
          persist(snapshot); // Refresh never extends the original expiry.
        }
        return true;
      } catch (error: unknown) {
        if (current !== requestId) return false;
        if (error instanceof ApiError && [401, 403].includes(error.status)) clearIdentity();
        nikolausFahrtStore.offline = true;
        nikolausFahrtStore.error = true;
        return false;
      }
    });
  } finally {
    if (current === requestId) nikolausFahrtStore.loading = false;
  }
}

/** Persist saved-route visits before transmission; unsaved routes require a connection. */
export async function markNikolausVisit(
  date: string,
  team: string,
  stop: StaffNikolausFahrtStop,
  visited: boolean
): Promise<void> {
  await locked(async () => {
    const snapshot = currentSnapshot();
    const mutation: FahrtMutation = {
      bookingId: stop.bookingId,
      visited,
      operationId: crypto.randomUUID(),
      version: stop.visitVersion,
      slotKey: stop.slotKey,
      status: 'pending',
    };
    if (snapshot?.data.date === date && snapshot.team === team) {
      if (snapshot.queue.some((entry) => entry.bookingId === stop.bookingId)) return;
      snapshot.queue.push(mutation);
      if (!persist(snapshot)) return;
      if (navigator.onLine) await flush(snapshot);
    } else {
      if (nikolausFahrtStore.offline || !navigator.onLine)
        throw new Error('Bitte die Route vor der Fahrt auf diesem Gerät speichern.');
      const saved = await transmit(date, mutation);
      requestId++;
      applyVisit(saved, nikolausFahrtStore.data);
    }
  });
}

/** Remove a queued mutation only after the user explicitly chooses to discard it. */
export async function discardNikolausVisit(operationId: string): Promise<void> {
  await locked(async () => {
    const snapshot = currentSnapshot();
    if (!snapshot) return;
    snapshot.queue = snapshot.queue.filter((entry) => entry.operationId !== operationId);
    persist(snapshot);
  });
}

/** Revalidate the saved route and remove expired snapshot-backed display data. */
export function expireNikolausRoute(): void {
  currentSnapshot();
}
