import { CONFIG } from './config';
import type { TaskDirectoryUser } from './task-directory-types';
function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^@/, '')
    .toLocaleLowerCase('de');
}
function forms(user: TaskDirectoryUser): string[] {
  const first = normalize(user.givenName || user.name.split(' ')[0]);
  return [normalize(user.name), first, ...(CONFIG.taskDirectory.shortNames[first] ?? [])];
}
function quoted(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(normalize(text));
}
/** Candidate IDs are per-request indexes, never account IDs or addresses. */
export function taskCandidates(
  users: readonly TaskDirectoryUser[]
): { id: number; displayName: string; givenName: string }[] {
  return users.flatMap((user, index) =>
    user.name.includes('@') || user.givenName.includes('@')
      ? []
      : [{ id: index + 1, displayName: user.name, givenName: user.givenName }]
  );
}
/** The selected name form must occur in the quote and identify exactly one directory member. */
export function checkedTaskAssignee(
  id: unknown,
  assignee: string,
  quote: string,
  users: readonly TaskDirectoryUser[]
): TaskDirectoryUser | undefined {
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > users.length)
    return undefined;
  if (users[id - 1].name.includes('@') || users[id - 1].givenName.includes('@')) return undefined;
  const name = normalize(assignee);
  if (!name || name.includes('@') || !quoted(quote, name)) return undefined;
  const matches = users.filter((user) => forms(user).includes(name));
  return matches.length === 1 && matches[0] === users[id - 1] ? matches[0] : undefined;
}
/** Also repair old, unassigned proposals at review time using the same strict matching rules. */
export function matchTaskAssignee(
  assignee: string,
  quote: string,
  users: readonly TaskDirectoryUser[]
): TaskDirectoryUser | undefined {
  return users.find((_, index) => checkedTaskAssignee(index + 1, assignee, quote, users));
}
