import { getClient } from "./token";
import { EnvironmentVariable, getEnvironment } from "./environment";

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

  const SHAREPOINT_HOST_NAME = getEnvironment(
    EnvironmentVariable.SHAREPOINT_HOST_NAME,
  );

  const SHAREPOINT_SITE_ID = getEnvironment(
    EnvironmentVariable.SHAREPOINT_SITE_ID,
  );

  let apiRequest = client.api(
    `/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/lists/${listId}/items`,
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

  const SHAREPOINT_HOST_NAME = getEnvironment(
    EnvironmentVariable.SHAREPOINT_HOST_NAME,
  );

  const SHAREPOINT_SITE_ID = getEnvironment(
    EnvironmentVariable.SHAREPOINT_SITE_ID,
  );

  let apiRequest = client.api(
    `/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/drives/${driveId}/root/children`,
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
