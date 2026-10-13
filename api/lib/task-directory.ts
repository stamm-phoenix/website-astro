import { getClient } from './token';
import { CONFIG } from './config';
import type { TaskDirectoryUser } from './task-directory-types';

export class TaskDirectoryConfigurationError extends Error {
  constructor() {
    super(
      'Entra-Personenliste nicht verfügbar: Gruppenmitgliedschaft und Graph-Berechtigungen für vollständige Benutzerprofile prüfen.'
    );
    this.name = 'TaskDirectoryConfigurationError';
  }
}

/** Only person accounts in the configured Leitende group, including nested memberships. */
export async function readTaskDirectory(
  signal: AbortSignal = AbortSignal.timeout(5000)
): Promise<TaskDirectoryUser[]> {
  const client = getClient();
  const path = `/groups/${encodeURIComponent(CONFIG.taskDirectory.groupId)}/transitiveMembers/microsoft.graph.user`;
  let next = `${path}?$select=id,displayName,givenName,surname,userPrincipalName,accountEnabled,userType&$count=true&$top=999`;
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
        .header('ConsistencyLevel', 'eventual')
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
        typeof user.displayName !== 'string' ||
        !user.displayName.trim() ||
        typeof user.userPrincipalName !== 'string' ||
        typeof user.accountEnabled !== 'boolean' ||
        typeof user.userType !== 'string'
      )
        continue;
      if (
        user.accountEnabled !== true ||
        user.userType !== 'Member' ||
        typeof user.givenName !== 'string' ||
        typeof user.surname !== 'string'
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
        new URL(next).pathname !== `/v1.0${path}`)
    )
      throw new Error('Invalid directory continuation');
  }
  if (!users.size) throw new TaskDirectoryConfigurationError();
  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Coalesce callers; keep a successful group snapshot five minutes, at most ten during outages. */
export function createTaskDirectoryCache(
  load: () => Promise<TaskDirectoryUser[]> = readTaskDirectory
): () => Promise<TaskDirectoryUser[]> {
  let cache: { key: string; at: number; users: TaskDirectoryUser[] } | undefined;
  let pending: { key: string; promise: Promise<TaskDirectoryUser[]> } | undefined;
  let retryAt = 0;
  return async () => {
    const key = JSON.stringify([CONFIG.taskDirectory.groupId, CONFIG.taskDirectory.domain]);
    const now = Date.now();
    const usable = cache?.key === key ? cache : undefined;
    if (usable && (now - usable.at < 300_000 || (now < retryAt && now - usable.at < 600_000)))
      return usable.users.map((user) => ({ ...user }));
    if (pending?.key === key) return (await pending.promise).map((user) => ({ ...user }));
    const promise = load()
      .then((users) => {
        cache = { key, at: Date.now(), users };
        retryAt = 0;
        return users;
      })
      .catch((error) => {
        if (
          !(error instanceof TaskDirectoryConfigurationError) &&
          usable &&
          Date.now() - usable.at < 600_000
        ) {
          retryAt = Date.now() + 30_000;
          return usable.users;
        }
        throw error;
      });
    pending = { key, promise };
    try {
      return (await promise).map((user) => ({ ...user }));
    } finally {
      if (pending?.promise === promise) pending = undefined;
    }
  };
}
export const getTaskDirectoryUsers = createTaskDirectoryCache();
