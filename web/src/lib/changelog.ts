import { isChangelogId } from '../../../api/lib/changelog-id';

/** A sentence of an entry; with `href` the page it is about gets a link after the sentence. */
export type ChangelogChange = string | { text: string; href: string };

/** One entry of the changelog of the Leitendenbereich, written in `changelog/entries/<id>.ts`. */
export interface ChangelogEntry {
  /** Date, number of the day and short name, see `api/lib/changelog-id.ts`. */
  id: string;
  /** Day of the change, `YYYY-MM-DD`; the same as the start of the `id`. */
  date: string;
  title: string;
  /** Whole sentences in plain German: what leaders can do now or what works differently. */
  changes: ChangelogChange[];
}

/** The entries ordered by ID, the newest first; an ID starts with the date and the number of the day. */
export function sortedNewestFirst(entries: readonly ChangelogEntry[]): ChangelogEntry[] {
  return [...entries].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** The entries newer than `lastSeenId`; all of them while nothing has been seen. */
export function unseenEntries(
  entries: readonly ChangelogEntry[],
  lastSeenId: string | null
): ChangelogEntry[] {
  if (lastSeenId === null) return [...entries];
  return entries.filter((entry) => entry.id > lastSeenId);
}

/** Keeps a new account's notice useful without pretending older entries were read. */
export function recentUnseenEntries(
  entries: readonly ChangelogEntry[],
  lastSeenId: string | null,
  limit: number
): ChangelogEntry[] {
  const unseen = unseenEntries(entries, lastSeenId);
  return lastSeenId === null ? unseen.slice(0, Math.max(0, limit)) : unseen;
}

/** The ID of the newest entry, or `null` for an empty changelog. */
export function newestEntryId(entries: readonly ChangelogEntry[]): string | null {
  return entries.reduce<string | null>(
    (newest, entry) => (newest === null || entry.id > newest ? entry.id : newest),
    null
  );
}

export function changeText(change: ChangelogChange): string {
  return typeof change === 'string' ? change : change.text;
}

/** Problems of entries that share the `YYYY-MM-DD-NN` prefix of their ID, which two PRs may pick at once. */
export function duplicateNumbers(entries: readonly ChangelogEntry[]): string[] {
  const byNumber = new Map<string, string[]>();
  for (const { id } of entries) {
    const number = id.slice(0, 13);
    byNumber.set(number, [...(byNumber.get(number) ?? []), id]);
  }
  return [...byNumber]
    .filter(([, ids]) => ids.length > 1)
    .map(([number, ids]) => `${number}: mehrfach vergeben (${ids.join(', ')})`);
}

/**
 * Problems of an entry list, for the test: bad IDs, wrong order, empty texts, and dates after
 * `today` (`YYYY-MM-DD`, Berlin), which an entry written from memory easily gets wrong.
 */
export function changelogProblems(
  entries: readonly ChangelogEntry[],
  today: string = '9999-12-31'
): string[] {
  const problems: string[] = [];
  entries.forEach((entry, index) => {
    if (!isChangelogId(entry.id)) problems.push(`${entry.id}: ungültige ID`);
    if (!entry.id.startsWith(entry.date)) problems.push(`${entry.id}: Datum passt nicht zur ID`);
    if (entry.date > today) problems.push(`${entry.id}: Datum liegt nach heute`);
    if (!entry.title.trim()) problems.push(`${entry.id}: Titel fehlt`);
    if (entry.changes.length === 0 || entry.changes.some((change) => !changeText(change).trim())) {
      problems.push(`${entry.id}: leere Änderung`);
    }
    const next = entries[index + 1];
    if (next && next.id >= entry.id) problems.push(`${next.id}: nicht absteigend sortiert`);
  });
  return problems;
}
