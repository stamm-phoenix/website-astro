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
export function eventGroupNames(event: object): string[] {
  const values: unknown[] = [
    'groups' in event ? event.groups : undefined,
    'group_names' in event ? event.group_names : undefined,
    'registration_groups' in event ? event.registration_groups : undefined,
  ];
  return values.flatMap((value) => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item: unknown) => {
      if (typeof item === 'string') return [item];
      const name = item && typeof item === 'object' && 'name' in item ? item.name : undefined;
      return typeof name === 'string' ? [name] : [];
    });
  });
}
