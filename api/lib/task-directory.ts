import { getClient } from './token';
import { CONFIG } from './config';
import type { TaskDirectoryUser } from './task-directory-types';

/** Enabled internal member accounts, shared by autocomplete and task recognition. */
export async function getTaskDirectoryUsers(): Promise<TaskDirectoryUser[]> {
  const client = getClient();
  const signal = AbortSignal.timeout(5000);
  let next =
    '/users?$select=id,displayName,givenName,surname,userPrincipalName,accountEnabled,userType&$filter=accountEnabled%20eq%20true%20and%20userType%20eq%20%27Member%27&$top=999';
  const users = new Map<string, TaskDirectoryUser>();
  const seen = new Set<string>();
  while (next) {
    if (seen.has(next) || seen.size >= 20) throw new Error('Invalid directory pagination');
    seen.add(next);
    signal.throwIfAborted();
    const page: unknown = await new Promise((resolve, reject) => {
      const aborted = (): void => reject(new Error('Directory request timed out'));
      signal.addEventListener('abort', aborted, { once: true });
      client
        .api(next)
        .option('signal', signal)
        .get()
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', aborted));
    });
    if (!page || typeof page !== 'object' || !('value' in page) || !Array.isArray(page.value))
      throw new Error('Invalid directory response');
    for (const item of page.value as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const user = item as Record<string, unknown>;
      if (
        user.accountEnabled !== true ||
        user.userType !== 'Member' ||
        typeof user.displayName !== 'string' ||
        typeof user.givenName !== 'string' ||
        typeof user.surname !== 'string' ||
        typeof user.userPrincipalName !== 'string'
      )
        continue;
      const login = user.userPrincipalName.trim().toLowerCase();
      if (
        !login.endsWith(`@${CONFIG.taskDirectory.domain}`) ||
        !user.givenName.trim() ||
        !user.surname.trim()
      )
        continue;
      users.set(login, { name: user.displayName.trim(), givenName: user.givenName.trim(), login });
    }
    const continuation = (page as Record<string, unknown>)['@odata.nextLink'];
    if (continuation !== undefined && typeof continuation !== 'string')
      throw new Error('Invalid directory continuation');
    next = (continuation as string) || '';
    if (
      next &&
      (new URL(next).origin !== 'https://graph.microsoft.com' ||
        new URL(next).pathname !== '/v1.0/users')
    )
      throw new Error('Invalid directory continuation');
  }
  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
