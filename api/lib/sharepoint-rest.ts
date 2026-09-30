import { getCredential } from './token';
import { EnvironmentVariable, getEnvironment } from './environment';

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
  const host = getEnvironment(EnvironmentVariable.SHAREPOINT_HOST_NAME);
  const siteName = getEnvironment(EnvironmentVariable.SHAREPOINT_SITE_NAME);
  return `https://${host}/sites/${siteName}/_api/web/lists(guid'${encodeURIComponent(listId)}')`;
}

async function sharePointRequest(
  url: string,
  init: { method: string; body?: BodyInit; contentType?: string }
): Promise<Response> {
  const host = getEnvironment(EnvironmentVariable.SHAREPOINT_HOST_NAME);
  const token = await getCredential().getToken(`https://${host}/.default`);
  if (!token) {
    throw new Error('Failed to acquire SharePoint access token');
  }

  const response = await fetch(url, {
    method: init.method,
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

/** Value for a location column in the format `ValidateUpdateListItem` expects. */
export function toLocationFieldValue(address: {
  street: string;
  postalCode: string;
  city: string;
}): string {
  if (!address.street && !address.postalCode && !address.city) return '';
  const displayName = [address.street, [address.postalCode, address.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return JSON.stringify({
    DisplayName: displayName,
    LocationUri: '',
    EntityType: 'PostalAddress',
    Address: {
      Street: address.street,
      City: address.city,
      State: '',
      CountryOrRegion: 'Deutschland',
      PostalCode: address.postalCode,
    },
    Coordinates: {},
  });
}

/** Value for an image column that points to an attachment of the item. */
export function toImageFieldValue(fieldName: string, fileName: string): string {
  return JSON.stringify({ type: 'thumbnail', fileName, fieldName });
}
