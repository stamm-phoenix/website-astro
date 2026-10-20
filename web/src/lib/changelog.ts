import { isChangelogId } from '../../../api/lib/changelog-id';

/** One entry of the changelog of the Leitendenbereich, written in `changelogEntries.ts`. */
export interface ChangelogEntry {
  /** Date plus short name, see `api/lib/changelog-id.ts`. */
  id: string;
  /** Day of the change, `YYYY-MM-DD`; the same as the start of the `id`. */
  date: string;
  title: string;
  /** Whole sentences in plain German: what leaders can do now or what works differently. */
  changes: string[];
}

/** The entries newer than `lastSeenId`; all of them while nothing has been seen. */
export function unseenEntries(
  entries: readonly ChangelogEntry[],
  lastSeenId: string | null
): ChangelogEntry[] {
  if (lastSeenId === null) return [...entries];
  return entries.filter((entry) => entry.id > lastSeenId);
}

/** The ID of the newest entry, or `null` for an empty changelog. */
export function newestEntryId(entries: readonly ChangelogEntry[]): string | null {
  return entries.reduce<string | null>(
    (newest, entry) => (newest === null || entry.id > newest ? entry.id : newest),
    null
  );
}

/** Problems of an entry list, for the test: bad IDs, wrong order, empty texts. */
export function changelogProblems(entries: readonly ChangelogEntry[]): string[] {
  const problems: string[] = [];
  entries.forEach((entry, index) => {
    if (!isChangelogId(entry.id)) problems.push(`${entry.id}: ungültige ID`);
    if (!entry.id.startsWith(entry.date)) problems.push(`${entry.id}: Datum passt nicht zur ID`);
    if (!entry.title.trim()) problems.push(`${entry.id}: Titel fehlt`);
    if (entry.changes.length === 0 || entry.changes.some((change) => !change.trim())) {
      problems.push(`${entry.id}: leere Änderung`);
    }
    const next = entries[index + 1];
    if (next && next.id >= entry.id) problems.push(`${next.id}: nicht absteigend sortiert`);
  });
  return problems;
}
