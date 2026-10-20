// Whether a CampFlow event is a real Aktion or only uses the registration and payment of
// CampFlow, e.g. an order of jumpers (#337). Lists and choices of Aktionen use `isAktion` and
// `nurAktionen`, so they all leave such events out the same way. The mark is switched by hand
// at the Aktion (`saveKeineAktion` in `aktionZuschuss.ts`).
import type { CampflowEvent } from './types';

/** Events running longer than this are likely orders or registrations, not an Aktion. */
const LANG_TAGE = 60;
/** Words in a title that hint at an order. */
const BESTELLUNG = /pulli|pullover|halstuch|halstücher|t-shirt|shirt|hoodie|bestellung|kluft/i;

/** Whether the event is a real Aktion; events without the mark (e.g. from old data) are. */
export function isAktion(event: Pick<CampflowEvent, 'keineAktion'>): boolean {
  return event.keineAktion !== true;
}

/** The events that are real Aktionen, for every list and choice of Aktionen. */
export function nurAktionen<T extends Pick<CampflowEvent, 'keineAktion'>>(events: T[]): T[] {
  return events.filter(isAktion);
}

/**
 * Why an unmarked event looks like no real Aktion (a very long run or a word like „Pulli“ in
 * its title), or `null`. It is only a hint; the mark is always set by hand.
 */
export function keineAktionHinweis(
  event: Pick<CampflowEvent, 'title' | 'start_date' | 'end_date' | 'keineAktion'>
): string | null {
  if (event.keineAktion) return null;
  if (BESTELLUNG.test(event.title)) return 'Der Name klingt nach einer Bestellung.';
  const start = Date.parse(event.start_date?.slice(0, 10) ?? '');
  const end = Date.parse(event.end_date?.slice(0, 10) ?? '');
  if (!Number.isNaN(start) && !Number.isNaN(end) && end - start > LANG_TAGE * 86_400_000) {
    return 'Es dauert mehrere Monate.';
  }
  return null;
}
