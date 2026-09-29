import type { InvocationContext } from '@azure/functions';
import { EnvironmentVariable, getEnvironment } from './environment';
import {
  createSharePointListItem,
  getSharePointListItems,
  updateSharePointListItem,
} from './sharepoint-data-access';

/**
 * Access token for the Instagram API (Instagram Login). Long-lived tokens expire after 60 days
 * and can only be refreshed while still valid, so the current token lives in a SharePoint list
 * and is refreshed on use. INSTAGRAM_ACCESS_TOKEN is only the initial (or replacement) token.
 */

export const INSTAGRAM_GRAPH_URL = 'https://graph.instagram.com';

const CACHE_TTL_MS = 60 * 60_000;
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60_000;
const TIMEOUT_MS = 10_000;

interface StoredToken {
  itemId: string;
  token: string;
  /** NaN if unknown */
  refreshedAt: number;
}

let cached: { token: string; expires: number } | undefined;
let pending: Promise<string> | undefined;

/** Returns a valid access token, refreshing and storing it when it is older than a week. */
export function getInstagramToken(context: InvocationContext): Promise<string> {
  if (cached && cached.expires > Date.now()) {
    return Promise.resolve(cached.token);
  }
  pending ??= loadToken(context)
    .then((token) => {
      cached = { token, expires: Date.now() + CACHE_TTL_MS };
      return token;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

/**
 * Called when Instagram rejected `rejectedToken`. If INSTAGRAM_ACCESS_TOKEN holds a different
 * token (e.g. a newly generated one after the stored token expired), it replaces the stored token.
 * @returns The replacement token, or undefined if there is none.
 */
export async function replaceInstagramToken(
  rejectedToken: string,
  context: InvocationContext
): Promise<string | undefined> {
  const initialToken = getEnvironment(EnvironmentVariable.INSTAGRAM_ACCESS_TOKEN);
  if (initialToken === rejectedToken) {
    return undefined;
  }
  context.warn('Instagram rejected the stored token, switching to INSTAGRAM_ACCESS_TOKEN');
  await storeToken(await readStoredToken(), initialToken);
  cached = { token: initialToken, expires: Date.now() + CACHE_TTL_MS };
  return initialToken;
}

async function loadToken(context: InvocationContext): Promise<string> {
  const stored = await readStoredToken();
  if (!stored) {
    const initialToken = getEnvironment(EnvironmentVariable.INSTAGRAM_ACCESS_TOKEN);
    await storeToken(undefined, initialToken);
    return initialToken;
  }

  // Also refreshes if the timestamp is missing or unreadable (NaN)
  if (!(Date.now() - stored.refreshedAt < REFRESH_AFTER_MS)) {
    try {
      const token = await refreshToken(stored.token);
      await storeToken(stored, token);
      context.log('Instagram access token refreshed');
      return token;
    } catch (error: unknown) {
      // The old token stays valid for weeks; the next attempt follows after CACHE_TTL_MS
      context.warn(
        `Refreshing the Instagram access token failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return stored.token;
}

async function readStoredToken(): Promise<StoredToken | undefined> {
  const listId = getEnvironment(EnvironmentVariable.SHAREPOINT_INSTAGRAM_TOKEN_LIST_ID);
  const items = await getSharePointListItems(listId, { expand: 'fields' });

  for (const item of items) {
    const listItem = item as { id: string; fields?: { Token?: string; RefreshedAt?: string } };
    const token = listItem.fields?.Token?.trim();
    if (token) {
      return {
        itemId: listItem.id,
        token,
        refreshedAt: Date.parse(listItem.fields?.RefreshedAt ?? ''),
      };
    }
  }
  return undefined;
}

async function storeToken(stored: StoredToken | undefined, token: string): Promise<void> {
  const listId = getEnvironment(EnvironmentVariable.SHAREPOINT_INSTAGRAM_TOKEN_LIST_ID);
  const fields = { Token: token, RefreshedAt: new Date().toISOString() };
  if (stored) {
    await updateSharePointListItem(listId, stored.itemId, fields);
  } else {
    await createSharePointListItem(listId, { Title: 'Instagram', ...fields });
  }
}

async function refreshToken(token: string): Promise<string> {
  const params = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token });
  // Never log this URL, it contains the token
  const response = await fetch(`${INSTAGRAM_GRAPH_URL}/refresh_access_token?${params.toString()}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => undefined)) as
    { access_token?: unknown; error?: { message?: unknown } } | undefined;
  if (!response.ok || typeof body?.access_token !== 'string') {
    const message = typeof body?.error?.message === 'string' ? body.error.message : '';
    throw new Error(`Instagram responded with ${response.status} ${message}`.trim());
  }
  return body.access_token;
}
