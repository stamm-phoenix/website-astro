/**
 * The four Stufen with the key used in URLs (`?gruppe=` of the calendar, `aktionen/<key>.ics`).
 * Shared with the frontend (`web/src/lib/events.ts`), so it has no imports.
 */
export const STUFE_KEYS = {
  woelflinge: 'Wölflinge',
  jupfis: 'Jungpfadfinder',
  pfadis: 'Pfadfinder',
  rover: 'Rover',
} as const;

export type StufeKey = keyof typeof STUFE_KEYS;

export function isStufeKey(value: string): value is StufeKey {
  return Object.hasOwn(STUFE_KEYS, value);
}

interface WithStufen {
  stufen: readonly string[];
}

/**
 * Whether an Aktion belongs in the feed of a Stufe: it lists that Stufe (the filter of the
 * calendar page), or it names no Stufe and is meant for everyone. Entries only for Leitende
 * are in none of these feeds.
 */
export function aktionInStufeFeed(aktion: WithStufen, stufe: StufeKey): boolean {
  if (aktion.stufen.length === 0) return true;
  return aktion.stufen.includes(STUFE_KEYS[stufe]);
}
