import type { TaskInput } from './aufgaben-model';
import type { SharePointSiteUser } from './sharepoint-rest';

/** Compare full names without guessing nicknames or constructing email addresses. */
function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');
}

/**
 * Resolve an explicitly named assignee only when their @mention occurs in the quoted source.
 * Multiple distinct logins for the same name remain ambiguous; participants alone are not owners.
 */
export function taggedTaskAssignee(
  task: Pick<TaskInput, 'assignee'> & { quote: string },
  users: SharePointSiteUser[]
): string | undefined {
  const assignee = normalized(task.assignee).replace(/^@\s*/, '');
  if (!assignee) return undefined;
  const quote = normalized(task.quote).replace(/@\s+/g, '@');
  const matches = users.filter((user) => {
    const name = normalized(user.name);
    if (!name || (assignee !== name && assignee !== normalized(user.login))) return false;
    const mention = `@${name}`;
    let start = quote.indexOf(mention);
    while (start !== -1) {
      const before = quote[start - 1] ?? '';
      const after = quote[start + mention.length] ?? '';
      if (!/[\p{L}\p{N}@._-]/u.test(before) && !/[\p{L}\p{N}_-]/u.test(after)) return true;
      start = quote.indexOf(mention, start + 1);
    }
    return false;
  });
  const logins = [...new Set(matches.map((user) => user.login.toLowerCase()))];
  return logins.length === 1 ? logins[0] : undefined;
}
