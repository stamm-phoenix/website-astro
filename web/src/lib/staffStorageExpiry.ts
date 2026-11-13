// The part of the expiry of local data of the Leitendenbereich that needs code: BaseLayout loads
// this module on a page only when one of the entries exists (names in `staffStorageKeys.ts`).
import { removeExpiredAbrechnungen } from './abrechnungAblage';
import { localDate } from './dateUtils';
import { readFahrtSnapshot } from './nikolausFahrtOffline';
import { forgetRouteShell } from './nikolausRouteShell';
import { FAHRT_STORAGE_KEY } from './staffStorageKeys';

/** Deletes the offline copy of the Nikolaus route and its cached page once it has expired. */
export function expireStoredRoute(): void {
  try {
    const raw = localStorage.getItem(FAHRT_STORAGE_KEY);
    if (raw) {
      const owner = (JSON.parse(raw) as { owner?: unknown }).owner;
      if (!readFahrtSnapshot(typeof owner === 'string' ? owner : '')) void forgetRouteShell();
    }
  } catch {
    try {
      localStorage.removeItem(FAHRT_STORAGE_KEY);
    } catch {
      /* Storage unavailable. */
    }
  }
}

/** Abrechnung entries contain personal data: gone one month after the KJR deadline. */
export function expireStoredAbrechnungen(): void {
  removeExpiredAbrechnungen(localDate());
}
