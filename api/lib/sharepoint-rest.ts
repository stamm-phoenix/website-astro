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

interface FieldResult {
  FieldName: string;
  HasException: boolean;
  ErrorMessage?: string | null;
}

/**
 * Sets column values through `ValidateUpdateListItem`, which also supports location and
 * image columns. Values are passed as strings in the format SharePoint forms use.
 */
export async function validateUpdateListItem(
  listId: string,
  itemId: string,
  values: Record<string, string>
): Promise<void> {
  const response = await sharePointRequest(
    `${getListUrl(listId)}/items(${Number(itemId)})/ValidateUpdateListItem()`,
    {
      method: 'POST',
      contentType: 'application/json;odata=nometadata',
      body: JSON.stringify({
        formValues: Object.entries(values).map(([FieldName, FieldValue]) => ({
          FieldName,
          FieldValue,
        })),
        bNewDocumentUpdate: false,
      }),
    }
  );

  const result = (await response.json()) as { value?: FieldResult[] };
  const failed = result.value?.filter((field) => field.HasException) ?? [];
  if (failed.length > 0) {
    throw new SharePointRestError(
      400,
      `SharePoint rejected ${failed.map((f) => `${f.FieldName} (${f.ErrorMessage ?? 'invalid'})`).join(', ')}`
    );
  }
}

/** Adds a file as attachment to a list item. */
export async function addListItemAttachment(
  listId: string,
  itemId: string,
  fileName: string,
  content: Uint8Array<ArrayBuffer>
): Promise<void> {
  await sharePointRequest(
    `${getListUrl(listId)}/items(${Number(itemId)})/AttachmentFiles/add(FileName='${encodeURIComponent(fileName.replace(/'/g, "''"))}')`,
    { method: 'POST', contentType: 'application/octet-stream', body: content }
  );
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

/** Removes an attachment from a list item; a missing attachment is ignored. */
export async function deleteListItemAttachment(
  listId: string,
  itemId: string,
  fileName: string
): Promise<void> {
  try {
    await sharePointRequest(
      `${getListUrl(listId)}/items(${Number(itemId)})/AttachmentFiles('${encodeURIComponent(fileName.replace(/'/g, "''"))}')`,
      { method: 'DELETE' }
    );
  } catch (error: unknown) {
    if (!(error instanceof SharePointRestError && error.status === 404)) throw error;
  }
}

/** Value for an image column that points to an attachment of the item. */
export function toImageFieldValue(fieldName: string, fileName: string): string {
  return JSON.stringify({ type: 'thumbnail', fileName, fieldName });
}

/** Value for a hyperlink column (`URL, description`; commas in the URL are doubled). */
export function toUrlFieldValue(url: string, description: string): string {
  return url ? `${url.replace(/,/g, ',,')}, ${description}` : '';
}
