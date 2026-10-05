/**
 * Maps CampFlow group names to Stufen. Shared with the frontend (`web/src/lib/campflowGroups.ts`),
 * so keep it free of imports and Node/browser-specific APIs.
 */

/** The Stufen in their usual order. */
const STUFEN_ORDER = ['Wölflinge', 'Jungpfadfinder', 'Pfadfinder', 'Rover'];

/** CampFlow groups (without emoji and gender star) that belong to a Stufe; first match wins. */
const GROUP_PREFIXES: [prefix: string, stufe: string][] = [
  ['wölfling', 'Wölflinge'],
  ['wös', 'Wölflinge'],
  ['jungpfadfinder', 'Jungpfadfinder'],
  ['jupfi', 'Jungpfadfinder'],
  ['pfadfinder', 'Pfadfinder'],
  ['pfadi', 'Pfadfinder'],
  ['rover', 'Rover'],
];

/** Fields of a CampFlow event that may hold its groups (names, or objects with a `name`). */
const EVENT_GROUP_FIELDS = ['groups', 'group_names', 'registration_groups'];

/** Maps a CampFlow group name like „🟠 Wölfling“ to a Stufe, or `undefined`. */
export function mapGroupToStufe(group: string): string | undefined {
  const key = group
    .replace(/[^\p{L}\s]/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('de');
  return GROUP_PREFIXES.find(([prefix]) => key.startsWith(prefix))?.[1];
}

/** The Stufen of the given group names, unique and in their usual order. */
export function stufenFromGroups(groups: unknown[]): string[] {
  const found = new Set(
    groups.map((group) => (typeof group === 'string' ? mapGroupToStufe(group) : undefined))
  );
  return STUFEN_ORDER.filter((stufe) => found.has(stufe));
}

/** Group names a CampFlow event carries itself, if CampFlow sends any. */
export function eventGroupNames(event: Record<string, unknown>): string[] {
  return EVENT_GROUP_FIELDS.flatMap((field) => {
    const value = event[field];
    if (!Array.isArray(value)) return [];
    return value.flatMap((item: unknown) => {
      if (typeof item === 'string') return [item];
      const name = (item as { name?: unknown } | null)?.name;
      return typeof name === 'string' ? [name] : [];
    });
  });
}
