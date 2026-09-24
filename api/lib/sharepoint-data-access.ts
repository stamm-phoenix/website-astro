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
 */
export async function updateSharePointListItem(
  listId: string,
  itemId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const client = getClient();

  await client
    .api(`${getListItemsPath(listId)}/${encodeURIComponent(itemId)}/fields`)
    .patch(fields);
}

/**
 * Deletes an item from a specified SharePoint list.
 * @param listId The ID of the SharePoint list.
 * @param itemId The ID of the list item.
 */
export async function deleteSharePointListItem(listId: string, itemId: string): Promise<void> {
  const client = getClient();

  await client.api(`${getListItemsPath(listId)}/${encodeURIComponent(itemId)}`).delete();
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
