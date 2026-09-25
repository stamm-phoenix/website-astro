import { getClient } from './token';
import { EnvironmentVariable, getEnvironment } from './environment';

/**
 * Interface for options to query SharePoint list items.
 */
interface SharePointQueryOptions {
  orderby?: string;
  select?: string;
  filter?: string;
  expand?: string;
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

  const SHAREPOINT_HOST_NAME = getEnvironment(EnvironmentVariable.SHAREPOINT_HOST_NAME);

  const SHAREPOINT_SITE_ID = getEnvironment(EnvironmentVariable.SHAREPOINT_SITE_ID);

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

  let response = await apiRequest.get();
  const items: unknown[] = Array.isArray(response?.value) ? [...response.value] : [];

  // Follow paging links so larger lists are returned completely
  while (typeof response?.['@odata.nextLink'] === 'string') {
    response = await client.api(response['@odata.nextLink']).get();
    if (Array.isArray(response?.value)) {
      items.push(...response.value);
    }
  }

  return items;
}

function getListItemsPath(listId: string): string {
  const SHAREPOINT_HOST_NAME = getEnvironment(EnvironmentVariable.SHAREPOINT_HOST_NAME);

  const SHAREPOINT_SITE_ID = getEnvironment(EnvironmentVariable.SHAREPOINT_SITE_ID);

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
export async function createSharePointListItem(
  listId: string,
  fields: Record<string, unknown>
): Promise<string> {
  const client = getClient();

  const response = await client.api(getListItemsPath(listId)).post({ fields });

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

  const SHAREPOINT_HOST_NAME = getEnvironment(EnvironmentVariable.SHAREPOINT_HOST_NAME);

  const SHAREPOINT_SITE_ID = getEnvironment(EnvironmentVariable.SHAREPOINT_SITE_ID);

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

  const SHAREPOINT_HOST_NAME = getEnvironment(EnvironmentVariable.SHAREPOINT_HOST_NAME);

  const SHAREPOINT_SITE_ID = getEnvironment(EnvironmentVariable.SHAREPOINT_SITE_ID);

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

  const SHAREPOINT_HOST_NAME = getEnvironment(EnvironmentVariable.SHAREPOINT_HOST_NAME);

  const SHAREPOINT_SITE_ID = getEnvironment(EnvironmentVariable.SHAREPOINT_SITE_ID);

  const response = await client
    .api(
      `/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/drives/${driveId}/items/${itemId}?$select=@microsoft.graph.downloadUrl`
    )
    .get();

  return response?.['@microsoft.graph.downloadUrl'];
}

function getDrivePath(driveId: string): string {
  const SHAREPOINT_HOST_NAME = getEnvironment(EnvironmentVariable.SHAREPOINT_HOST_NAME);

  const SHAREPOINT_SITE_ID = getEnvironment(EnvironmentVariable.SHAREPOINT_SITE_ID);

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
