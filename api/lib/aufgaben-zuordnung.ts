import type { TaskInput } from './aufgaben-model';
export interface SharePointSiteUser {
  name: string;
  /** Membership claim's UPN, which matches the Entra login used by the staff area. */
  login: string;
}

/** Compare full names without guessing nicknames or constructing email addresses. */
function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');
}

/** Apply the tribe's first.last login convention to a complete two-part name; keep short names manual. */
export function taskAssigneeLogin(value: string): string {
  const name = normalized(value).replace(/^@\s*/, '');
  if (name.includes('@')) return name;
  const parts = /^([\p{L}][\p{L}-]+) ([\p{L}][\p{L}-]+)$/u.exec(name);
  if (!parts) return value.trim();
  const loginName = `${parts[1]}.${parts[2]}`
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (!/^[a-z-]+\.[a-z-]+$/.test(loginName)) return value.trim();
  const login = `${loginName}@stamm-phoenix.de`;
  return login.length <= 254 ? login : value.trim();
}

/** Match stored names as well as logins, without assigning empty fields or first names to an account. */
export function taskAssignedToLogin(assignee: string, login: string | undefined): boolean {
  if (!login?.trim() || !assignee.trim()) return false;
  const resolved = taskAssigneeLogin(assignee);
  return resolved.includes('@') && resolved.toLowerCase() === login.trim().toLowerCase();
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
