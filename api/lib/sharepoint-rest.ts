import type { SharePointSiteUser } from './sharepoint-types';
import { getCredential } from './token';
import { CONFIG } from './config';

/**
 * Minimal client for the SharePoint REST API, for the few things Microsoft Graph cannot do:
 * writing location and image columns, and list item attachments.
 */

export class SharePointRestError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'SharePointRestError';
  }
}

function getListUrl(listId: string): string {
  const host = CONFIG.sharepoint.site.hostName;
  const siteName = CONFIG.sharepoint.site.name;
  return `https://${host}/sites/${siteName}/_api/web/lists(guid'${encodeURIComponent(listId)}')`;
}

async function sharePointRequest(
  url: string,
  init: { method: string; body?: BodyInit; contentType?: string; signal?: AbortSignal }
): Promise<Response> {
  const host = CONFIG.sharepoint.site.hostName;
  const token = await getCredential().getToken(`https://${host}/.default`, {
    abortSignal: init.signal,
  });
  if (!token) {
    throw new Error('Failed to acquire SharePoint access token');
  }

  const response = await fetch(url, {
    method: init.method,
    signal: init.signal,
    headers: {
      Authorization: `Bearer ${token.token}`,
      Accept: 'application/json;odata=nometadata',
      ...(init.contentType ? { 'Content-Type': init.contentType } : {}),
    },
    body: init.body,
  });

  if (!response.ok) {
    throw new SharePointRestError(
      response.status,
      `SharePoint REST ${init.method} failed: ${response.status} ${response.statusText}`
    );
  }
  return response;
}

/** Read local site identities for tag resolution, with a bounded timeout and no directory permission. */
export async function getSharePointSiteUsers(): Promise<SharePointSiteUser[]> {
  const base = new URL(
    `https://${CONFIG.sharepoint.site.hostName}/sites/${CONFIG.sharepoint.site.name}/_api/web/siteusers`
  );
  let url: string | undefined =
    `${base}?$select=Title,LoginName,PrincipalType&$filter=PrincipalType%20eq%201`;
  const signal = AbortSignal.timeout(5000);
  const seen = new Set<string>();
  const users: SharePointSiteUser[] = [];
  while (url) {
    const page = new URL(url, base);
    if (page.origin !== base.origin || page.pathname !== base.pathname || seen.has(page.href))
      throw new Error('Invalid SharePoint site users continuation');
    seen.add(page.href);
    const response = await sharePointRequest(page.href, { method: 'GET', signal });
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('value' in body) || !Array.isArray(body.value))
      throw new Error('Invalid SharePoint site users response');
    for (const item of body.value) {
      if (!item || typeof item !== 'object') continue;
      const { Title, LoginName, PrincipalType } = item;
      if (PrincipalType !== 1 || typeof Title !== 'string' || typeof LoginName !== 'string')
        continue;
      const claim = /^i:0#\.f\|membership\|([^|]+)$/i.exec(LoginName);
      const login = claim?.[1].trim().toLowerCase();
      if (
        !login ||
        login.includes('#ext#') ||
        !/^[^\s@]+@[^\s@]+$/.test(login) ||
        login.length > 254 ||
        !Title.trim()
      )
        continue;
      users.push({ name: Title.trim(), login });
    }
    const next =
      'odata.nextLink' in body
        ? body['odata.nextLink']
        : '@odata.nextLink' in body
          ? body['@odata.nextLink']
          : undefined;
    url = typeof next === 'string' && next ? next : undefined;
  }
  return users;
}

/** Content of an attachment of a list item. */
export async function getListItemAttachment(
  listId: string,
  itemId: string,
  fileName: string
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await sharePointRequest(
    `${getListUrl(listId)}/items(${Number(itemId)})/AttachmentFiles('${encodeURIComponent(fileName.replace(/'/g, "''"))}')/$value`,
    { method: 'GET' }
  );
  return new Uint8Array(await response.arrayBuffer());
}
