import { getClient } from './token';
import { ResponseType } from '@microsoft/microsoft-graph-client';
import { CONFIG } from './config';

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

/** HTTP status of a Microsoft Graph error, if available. */
export function getGraphStatus(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown })?.statusCode;
  return typeof status === 'number' ? status : undefined;
}

function getDrivePath(driveId: string): string {
  const SHAREPOINT_HOST_NAME = CONFIG.sharepoint.site.hostName;

  const SHAREPOINT_SITE_ID = CONFIG.sharepoint.site.id;

  return `/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/drives/${driveId}`;
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
 * Downloads a file of a drive by its path (`folder/file.docx`). Unlike a sharing link, this
 * works with `Sites.Selected`, which only grants the configured site.
 */
export async function getSharePointDriveFileContentByPath(
  driveId: string,
  path: string
): Promise<Uint8Array<ArrayBuffer>> {
  const content: ArrayBuffer = await getClient()
    .api(`${getDrivePath(driveId)}/root:/${encodeDrivePath(path)}:/content`)
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

/** File metadata without application-specific library columns. */
export async function getSharePointDriveItem(
  driveId: string,
  itemId: string
): Promise<unknown | undefined> {
  try {
    return await getClient()
      .api(`${getDrivePath(driveId)}/items/${encodeURIComponent(itemId)}`)
      .get();
  } catch (error) {
    if (getGraphStatus(error) === 404) return undefined;
    throw error;
  }
}
export async function getSharePointDriveFolderChildren(
  driveId: string,
  folderPath: string
): Promise<unknown[]> {
  const client = getClient();
  const response: unknown = await client
    .api(`${getDrivePath(driveId)}/root:/${encodeDrivePath(folderPath)}:/children`)
    .get();
  return collectGraphCollectionPages(response, async (nextLink) => client.api(nextLink).get());
}
