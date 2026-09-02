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

interface GraphCollectionPage {
  value?: unknown;
  '@odata.nextLink'?: unknown;
}

/** Returns whether an untrusted Graph response can be inspected as a collection page. */
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

  const response: unknown = await apiRequest.get();

  return collectGraphCollectionPages(response, async (nextLink) => client.api(nextLink).get());
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
