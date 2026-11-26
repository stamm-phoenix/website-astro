/**
 * The part of the page of a Planung in an entry of the browser's history
 * (`planNavigation.svelte.ts`). The entry also holds the keys of Astro's ClientRouter (`index`,
 * `scrollX`, `scrollY`) and the trips of `PlanEinkauf.svelte`; this part sits under a key of its
 * own. Without Svelte and the router, so the decisions can be unit-tested.
 */

export type Bereich =
  | 'plan'
  | 'gerichte'
  | 'teilnehmende'
  | 'einkauf'
  | 'lager'
  | 'packliste'
  | 'belege'
  | 'mitglieder'
  | 'einstellungen';

/** Key in `history.state`. */
export const VERLAUF = 'essensplanungSeite';

export interface Eintrag {
  bereich: Bereich;
  gericht: number | null;
  von: Bereich | null;
  /**
   * The router's `index` of the entry that opened the dish. A copy of the part in another entry
   * (the trips spread the state) has another index, so „Zurück“ steps back only from the entry
   * that opened the dish.
   */
  schritt: number | null;
}

/** The state of an entry as an object, empty for none. */
export function alsZustand(state: unknown): Record<string, unknown> {
  return state && typeof state === 'object' ? (state as Record<string, unknown>) : {};
}

/** The navigation's part of an entry, or null for an entry without it. */
export function eintragVon(state: unknown): Eintrag | null {
  const wert = alsZustand(state)[VERLAUF];
  return typeof wert === 'object' && wert !== null && 'bereich' in wert ? (wert as Eintrag) : null;
}

/** The router's index of an entry, or null without one. */
export function indexVon(state: unknown): number | null {
  const { index } = alsZustand(state);
  return typeof index === 'number' && Number.isInteger(index) ? index : null;
}

/**
 * Whether „Zurück“ on the dish `gericht` steps back in the history: only from the entry that
 * opened it, whose step before is where it was opened from.
 */
export function oeffnenderSchritt(state: unknown, gericht: number | null): boolean {
  const eintrag = eintragVon(state);
  const index = indexVon(state);
  return (
    gericht !== null &&
    eintrag?.gericht === gericht &&
    eintrag.von !== null &&
    index !== null &&
    eintrag.schritt === index
  );
}
