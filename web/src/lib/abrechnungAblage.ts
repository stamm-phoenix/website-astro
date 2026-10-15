// Entries to the Abrechnung of an Aktion kept on this device (`abrechnungStore.svelte.ts`). They
// can contain names, ages and Postleitzahlen of participants, so they are deleted one month after
// the KJR deadline. Free of Svelte, so that BaseLayout can remove expired entries on every page.
import { addMonths } from './kjrFristen';

export const ABRECHNUNG_STORAGE_PREFIX = 'phoenix:abrechnung:v1:';

/** Months after the KJR deadline until the entries of an Aktion are deleted from the device. */
export const ABRECHNUNG_AUFBEWAHRUNG_MONATE = 1;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The last day (`YYYY-MM-DD`) the entries are kept for an Aktion with the KJR deadline `frist`. */
export function abrechnungLoeschdatum(frist: string): string {
  return addMonths(frist, ABRECHNUNG_AUFBEWAHRUNG_MONATE);
}

/** The last day an entry as stored is kept, or `null` if it has none. */
export function storedLoeschdatum(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('deleteAfter' in value)) return null;
  const { deleteAfter } = value;
  return typeof deleteAfter === 'string' && DATE_PATTERN.test(deleteAfter) ? deleteAfter : null;
}

/** Removes the stored entries of all Aktionen whose last day is before `today`. */
export function removeExpiredAbrechnungen(today: string): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(ABRECHNUNG_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      let deleteAfter: string | null = null;
      try {
        deleteAfter = storedLoeschdatum(JSON.parse(localStorage.getItem(key) ?? 'null'));
      } catch {
        // Not JSON: the Abrechnung page ignores it as well
      }
      if (deleteAfter !== null && deleteAfter < today) localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable: nothing is kept that could expire
  }
}
