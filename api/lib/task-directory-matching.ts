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
const NAME_CHARACTERS = "\\p{L}\\p{M}\\p{N}\\p{Pd}'’";
function occurrences(text: string, name: string): RegExpMatchArray[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    ...text
      .normalize('NFKC')
      .matchAll(new RegExp(`(?<![${NAME_CHARACTERS}])${escaped}(?![${NAME_CHARACTERS}])`, 'giu')),
  ];
}
function quotedPerson(text: string, name: string, user: TaskDirectoryUser): boolean {
  const matches = occurrences(text, name);
  if (!matches.length) return false;
  if (name === normalize(user.name)) return true;
  const surname = user.name.slice(user.givenName.length).trim();
  // A shortened answer must not erase a different surname in the source. Be conservative
  // with capitalized words and surname particles; an uncertain match stays manual.
  return matches.every((match) => {
    const tail = text.normalize('NFKC').slice(match.index! + match[0].length);
    const following =
      /^\s+((?:(?:von|van|de|der|den|zu|del|la)\s+)*[\p{Lu}][\p{L}\p{M}\p{Pd}'’]*)/u.exec(tail);
    return (
      !following ||
      (surname !== '' &&
        occurrences(tail.trimStart(), normalize(surname)).some((value) => value.index === 0))
    );
  });
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
  if (!name || name.includes('@')) return undefined;
  const matches = users.filter((user) => forms(user).includes(name));
  return matches.length === 1 &&
    matches[0] === users[id - 1] &&
    quotedPerson(quote, name, matches[0])
    ? matches[0]
    : undefined;
}
/** Also repair old, unassigned proposals at review time using the same strict matching rules. */
export function matchTaskAssignee(
  assignee: string,
  quote: string,
  users: readonly TaskDirectoryUser[]
): TaskDirectoryUser | undefined {
  return users.find((_, index) => checkedTaskAssignee(index + 1, assignee, quote, users));
}
