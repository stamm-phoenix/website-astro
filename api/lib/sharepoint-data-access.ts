import { getClient } from './token';
import { ResponseType } from '@microsoft/microsoft-graph-client';
import { CONFIG } from './config';

/**
 * Interface for options to query SharePoint list items.
 */
interface SharePointQueryOptions {
  orderby?: string;
  select?: string;
  filter?: string;
  expand?: string;
}

interface GraphCollectionPage {
  value?: unknown;
  '@odata.nextLink'?: unknown;
}

/**
 * Determines whether a value is a non-null object suitable for collection-page inspection.
 *
 * @returns `true` if the value is a non-null object, `false` otherwise.
 */
function isGraphCollectionPage(value: unknown): value is GraphCollectionPage {
  return typeof value === 'object' && value !== null;
}

/**
 * Collects a Microsoft Graph collection and follows every opaque continuation URL.
 * @param firstPage The first Graph collection response.
 * @param getNextPage Fetches a page from an opaque `@odata.nextLink` URL.
 * @returns All values from the first and subsequent pages.
 */
export async function collectGraphCollectionPages(
  firstPage: unknown,
  getNextPage: (nextLink: string) => Promise<unknown>
): Promise<unknown[]> {
  const items: unknown[] = [];
  let page: unknown = firstPage;

  while (isGraphCollectionPage(page)) {
    if (Array.isArray(page.value)) {
      items.push(...page.value);
    }

    const nextLink = page['@odata.nextLink'];
    if (typeof nextLink !== 'string' || !nextLink) break;
    page = await getNextPage(nextLink);
  }

  return items;
}

/**
 * Fetches items from a specified SharePoint list.
 * @param listId The ID of the SharePoint list.
 * @param options Query options for the Microsoft Graph API.
 * @returns A promise that resolves to an array of raw SharePoint list items.
 */
export async function getSharePointListItems(
  listId: string,
  options?: SharePointQueryOptions
): Promise<unknown[]> {
  const client = getClient();

  const SHAREPOINT_HOST_NAME = CONFIG.sharepoint.site.hostName;

  const SHAREPOINT_SITE_ID = CONFIG.sharepoint.site.id;

  let apiRequest = client.api(
    `/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/lists/${listId}/items`
  );

  if (options?.orderby) {
    apiRequest = apiRequest.orderby(options.orderby);
  }
  if (options?.select) {
    apiRequest = apiRequest.select(options.select);
  }
  if (options?.filter) {
    apiRequest = apiRequest.filter(options.filter);
  }
  if (options?.expand) {
    apiRequest = apiRequest.expand(options.expand);
  }

  const response: unknown = await apiRequest.get();

  return collectGraphCollectionPages(response, async (nextLink) => client.api(nextLink).get());
}

function getListItemsPath(listId: string): string {
  const SHAREPOINT_HOST_NAME = CONFIG.sharepoint.site.hostName;

  const SHAREPOINT_SITE_ID = CONFIG.sharepoint.site.id;

  return `/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/lists/${listId}/items`;
}

/**
 * Fetches a single item (including its fields) from a specified SharePoint list.
 * @param listId The ID of the SharePoint list.
 * @param itemId The ID of the list item.
 * @returns A promise that resolves to the raw list item, or undefined if it does not exist.
 */
export async function getSharePointListItem(
  listId: string,
  itemId: string
): Promise<unknown | undefined> {
  const client = getClient();

  try {
    return await client
      .api(`${getListItemsPath(listId)}/${encodeURIComponent(itemId)}`)
      .expand('fields')
      .get();
  } catch (error: unknown) {
    if ((error as { statusCode?: number })?.statusCode === 404) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Creates a new item in a specified SharePoint list.
 * @param listId The ID of the SharePoint list.
 * @param fields The column values of the new item (internal column names).
 * @returns A promise that resolves to the ID of the created item.
 */
export interface CreatedSharePointItem {
  id: string;
  etag: string;
}

/** Creates an item and keeps its initial version for safe rollback. */
export async function createSharePointListItemWithVersion(
  listId: string,
  fields: Record<string, unknown>
): Promise<CreatedSharePointItem> {
  const response = await getClient().api(getListItemsPath(listId)).post({ fields });
  if (typeof response?.eTag !== 'string' || !response.eTag || response.eTag === '*') {
    throw new Error('SharePoint did not return an initial item version.');
  }
  return { id: String(response.id), etag: response.eTag };
}

export async function createSharePointListItem(
  listId: string,
  fields: Record<string, unknown>
): Promise<string> {
  const response = await getClient().api(getListItemsPath(listId)).post({ fields });
  return String(response.id);
}

/**
 * Updates column values of an existing SharePoint list item.
 * @param listId The ID of the SharePoint list.
 * @param itemId The ID of the list item.
 * @param fields The column values to update (internal column names).
 * @param etag Optional eTag of the item as loaded; the update then fails with status 412
 *   if the item was changed in the meantime.
 */
export async function updateSharePointListItem(
  listId: string,
  itemId: string,
  fields: Record<string, unknown>,
  etag?: string
): Promise<void> {
  const client = getClient();

  let request = client.api(`${getListItemsPath(listId)}/${encodeURIComponent(itemId)}/fields`);
  if (etag) {
    request = request.header('If-Match', etag);
  }
  await request.patch(fields);
}

/**
 * Fetches the column definitions of a SharePoint list (e.g. to read choice values).
 * @param listId The ID of the SharePoint list.
 * @returns A promise that resolves to the raw column definitions.
 */
export async function getSharePointListColumns(listId: string): Promise<unknown[]> {
  const client = getClient();

  const SHAREPOINT_HOST_NAME = CONFIG.sharepoint.site.hostName;

  const SHAREPOINT_SITE_ID = CONFIG.sharepoint.site.id;

  const response = await client
    .api(`/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/lists/${listId}/columns`)
    .get();

  return Array.isArray(response?.value) ? response.value : [];
}

/** Returns the choice values of a choice column, or an empty list if there are none. */
export async function getSharePointChoiceValues(listId: string, column: string): Promise<string[]> {
  const columns = (await getSharePointListColumns(listId)) as {
    name?: string;
    choice?: { choices?: string[] };
  }[];
  return columns.find((c) => c.name === column)?.choice?.choices ?? [];
}

/** HTTP status of a Microsoft Graph error, if available. */
export function getGraphStatus(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown })?.statusCode;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Deletes an item from a specified SharePoint list.
 * @param listId The ID of the SharePoint list.
 * @param itemId The ID of the list item.
 * @param etag Optional eTag of the item as loaded; the delete then fails with status 412
 *   if the item was changed in the meantime.
 */
export async function deleteSharePointListItem(
  listId: string,
  itemId: string,
  etag?: string
): Promise<void> {
  const client = getClient();

  let request = client.api(`${getListItemsPath(listId)}/${encodeURIComponent(itemId)}`);
  if (etag) {
    request = request.header('If-Match', etag);
  }
  await request.delete();
}

/**
 * Fetches children of the root folder from a specified SharePoint drive.
 * @param driveId The ID of the SharePoint drive.
 * @param options Query options for the Microsoft Graph API.
 * @returns A promise that resolves to an array of raw SharePoint drive items.
 */
export async function getSharePointDriveRootChildren(
  driveId: string,
  options?: SharePointQueryOptions
): Promise<unknown[]> {
  const client = getClient();

  const SHAREPOINT_HOST_NAME = CONFIG.sharepoint.site.hostName;

  const SHAREPOINT_SITE_ID = CONFIG.sharepoint.site.id;

  let apiRequest = client.api(
    `/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/drives/${driveId}/root/children`
  );

  if (options?.orderby) {
    apiRequest = apiRequest.orderby(options.orderby);
  }
  if (options?.select) {
    apiRequest = apiRequest.select(options.select);
  }
  if (options?.filter) {
    apiRequest = apiRequest.filter(options.filter);
  }
  if (options?.expand) {
    apiRequest = apiRequest.expand(options.expand);
  }

  const response = await apiRequest.get();

  return Array.isArray(response?.value) ? response.value : [];
}

/**
 * Fetches the download URL for a specified SharePoint drive item.
 * @param driveId The ID of the SharePoint drive.
 * @param itemId The ID of the drive item.
 * @returns A promise that resolves to the download URL or undefined.
 */
export async function getSharePointDriveItemDownloadUrl(
  driveId: string,
  itemId: string
): Promise<string | undefined> {
  const client = getClient();

  const SHAREPOINT_HOST_NAME = CONFIG.sharepoint.site.hostName;

  const SHAREPOINT_SITE_ID = CONFIG.sharepoint.site.id;

  const response = await client
    .api(
      `/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/drives/${driveId}/items/${itemId}?$select=@microsoft.graph.downloadUrl`
    )
    .get();

  return response?.['@microsoft.graph.downloadUrl'];
}

function getDrivePath(driveId: string): string {
  const SHAREPOINT_HOST_NAME = CONFIG.sharepoint.site.hostName;

  const SHAREPOINT_SITE_ID = CONFIG.sharepoint.site.id;

  return `/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/drives/${driveId}`;
}

/**
 * Checks whether a file with the given name exists in the root folder of a drive.
 * @param driveId The ID of the SharePoint drive.
 * @param fileName The file name (without path).
 */
export async function sharePointDriveRootFileExists(
  driveId: string,
  fileName: string
): Promise<boolean> {
  const client = getClient();

  try {
    await client
      .api(`${getDrivePath(driveId)}/root:/${encodeURIComponent(fileName)}`)
      .select('id')
      .get();
    return true;
  } catch (error: unknown) {
    if (getGraphStatus(error) === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Creates an upload session for a file in the root folder of a drive. The returned URL is
 * pre-authenticated and short-lived; the file content is uploaded to it directly.
 * @param driveId The ID of the SharePoint drive.
 * @param fileName The file name (without path).
 * @param replace Whether an existing file with the same name is replaced.
 * @returns The upload URL.
 */
export async function createSharePointDriveUploadSession(
  driveId: string,
  fileName: string,
  replace: boolean
): Promise<string> {
  const client = getClient();

  const response = await client
    .api(`${getDrivePath(driveId)}/root:/${encodeURIComponent(fileName)}:/createUploadSession`)
    .post({
      item: { '@microsoft.graph.conflictBehavior': replace ? 'replace' : 'fail' },
    });

  return String(response.uploadUrl);
}

/**
 * Renames an item in a drive.
 * @param driveId The ID of the SharePoint drive.
 * @param itemId The ID of the drive item.
 * @param name The new name.
 */
export async function renameSharePointDriveItem(
  driveId: string,
  itemId: string,
  name: string
): Promise<void> {
  const client = getClient();

  // Renaming onto an existing name fails with 409 (nameAlreadyExists)
  await client.api(`${getDrivePath(driveId)}/items/${encodeURIComponent(itemId)}`).patch({ name });
}

/**
 * Deletes an item from a drive (it goes to the site's recycle bin).
 * @param driveId The ID of the SharePoint drive.
 * @param itemId The ID of the drive item.
 */
export async function deleteSharePointDriveItem(driveId: string, itemId: string): Promise<void> {
  const client = getClient();

  await client.api(`${getDrivePath(driveId)}/items/${encodeURIComponent(itemId)}`).delete();
}

/** Encodes each segment of a path inside a drive, keeping the slashes. */
function encodeDrivePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

const driveIdsByName = new Map<string, string>();

/**
 * Finds a document library of the site by the name in its URL (e.g. `Unterlagen` for
 * `…/sites/leitende/Unterlagen`) or its display name. The result is cached per instance.
 * @returns The drive ID, or undefined if the site has no such library.
 */
export async function getSharePointDriveIdByName(name: string): Promise<string | undefined> {
  const cached = driveIdsByName.get(name);
  if (cached) return cached;
  const client = getClient();
  const response: unknown = await client
    .api(`/sites/${CONFIG.sharepoint.site.hostName},${CONFIG.sharepoint.site.id}/drives`)
    .select('id,name,webUrl')
    .get();
  const drives = (await collectGraphCollectionPages(response, async (nextLink) =>
    client.api(nextLink).get()
  )) as { id?: string; name?: string; webUrl?: string }[];
  const urlName = (drive: { webUrl?: string }): string =>
    decodeURIComponent(drive.webUrl?.split('/').pop() ?? '');
  const drive =
    drives.find((d) => urlName(d) === name) ?? drives.find((d) => d.name === name && d.id);
  if (drive?.id) driveIdsByName.set(name, drive.id);
  return drive?.id;
}

/**
 * Fetches the files and folders in a folder of a drive, each with the column values of its
 * library item (`listItem.fields`).
 * @param folderPath Path of the folder relative to the root folder, e.g. `Protokolle/Sitzungen`.
 */
export async function getSharePointDriveFolderChildrenWithFields(
  driveId: string,
  folderPath: string
): Promise<unknown[]> {
  const client = getClient();
  const response: unknown = await client
    .api(`${getDrivePath(driveId)}/root:/${encodeDrivePath(folderPath)}:/children`)
    .expand('listItem($expand=fields)')
    .get();
  return collectGraphCollectionPages(response, async (nextLink) => client.api(nextLink).get());
}

/**
 * Fetches a drive item with the column values of its library item.
 * @returns The raw drive item, or undefined if it does not exist.
 */
export async function getSharePointDriveItemWithFields(
  driveId: string,
  itemId: string
): Promise<unknown | undefined> {
  try {
    return await getClient()
      .api(`${getDrivePath(driveId)}/items/${encodeURIComponent(itemId)}`)
      .expand('listItem($expand=fields)')
      .get();
  } catch (error: unknown) {
    if (getGraphStatus(error) === 404) return undefined;
    throw error;
  }
}

/**
 * Downloads a file of a drive.
 * @param format Converts the file first, e.g. `pdf` for Word documents.
 */
export async function getSharePointDriveFileContent(
  driveId: string,
  itemId: string,
  format?: 'pdf'
): Promise<Uint8Array<ArrayBuffer>> {
  let request = getClient()
    .api(`${getDrivePath(driveId)}/items/${encodeURIComponent(itemId)}/content`)
    .responseType(ResponseType.ARRAYBUFFER);
  if (format) request = request.query({ format });
  const content: ArrayBuffer = await request.get();
  return new Uint8Array(content);
}

/**
 * Downloads the file behind a SharePoint sharing link (e.g. `https://…/:w:/s/site/…`).
 * The app needs read access to the file; the link itself grants nothing to the app.
 */
export async function getSharedFileContent(sharingUrl: string): Promise<Uint8Array<ArrayBuffer>> {
  // https://learn.microsoft.com/graph/api/shares-get#encoding-sharing-urls
  const token = `u!${Buffer.from(sharingUrl).toString('base64url')}`;
  const content: ArrayBuffer = await getClient()
    .api(`/shares/${token}/driveItem/content`)
    .responseType(ResponseType.ARRAYBUFFER)
    .get();
  return new Uint8Array(content);
}

/**
 * Creates a short-lived URL that shows a file read-only in an iframe, without a SharePoint
 * login in the browser.
 */
export async function getSharePointDriveItemPreviewUrl(
  driveId: string,
  itemId: string
): Promise<string> {
  const response = (await getClient()
    .api(`${getDrivePath(driveId)}/items/${encodeURIComponent(itemId)}/preview`)
    .post({})) as { getUrl?: unknown };
  if (typeof response?.getUrl !== 'string' || !response.getUrl.startsWith('https://')) {
    throw new Error('SharePoint did not return a preview URL.');
  }
  return response.getUrl;
}

/**
 * Uploads a small file (up to 250 MB) into a folder of a drive. Fails with status 409 if a file
 * with that name exists.
 * @param folderPath Path of the folder relative to the root folder.
 * @returns The raw created drive item.
 */
export async function createSharePointDriveFile(
  driveId: string,
  folderPath: string,
  fileName: string,
  content: Uint8Array
): Promise<unknown> {
  return getClient()
    .api(`${getDrivePath(driveId)}/root:/${encodeDrivePath(`${folderPath}/${fileName}`)}:/content`)
    .query({ '@microsoft.graph.conflictBehavior': 'fail' })
    .header('Content-Type', 'application/octet-stream')
    .put(content);
}

/**
 * Updates column values of the library item of a drive item.
 * @param etag Optional eTag of the library item as loaded; the update then fails with status
 *   412 if the item or its file was changed in the meantime.
 */
export async function updateSharePointDriveItemFields(
  driveId: string,
  itemId: string,
  fields: Record<string, unknown>,
  etag?: string
): Promise<void> {
  let request = getClient().api(
    `${getDrivePath(driveId)}/items/${encodeURIComponent(itemId)}/listItem/fields`
  );
  if (etag) request = request.header('If-Match', etag);
  await request.patch(fields);
}
