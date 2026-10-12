import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import type { ContainerClient, UserDelegationKey } from '@azure/storage-blob';
import type { TokenCredential } from '@azure/identity';
import { CONFIG } from './config';
import { getCredential } from './token';

/**
 * Files in Azure Blob Storage (`CONFIG.storage`), e.g. the images of blog posts. The website
 * signs in with its app registration (role „Storage Blob Data Contributor“); the account
 * allows no public access and no shared keys. Blobs are only served through the API, which
 * checks first whether a file may be shown. See `docs/azure-sql.md`.
 *
 * The one exception is the audio of the Mitschriften (`docs/mitschriften.md`): the browser
 * uploads it with a short-lived, write-only SAS, and only Azure Speech gets a link to read it.
 */

export interface BlobTarget {
  account: string;
  container: string;
  credential: TokenCredential;
}

let container: ContainerClient | undefined;
let override: BlobTarget | undefined;

function accountUrl(account: string): string {
  return `https://${account}.blob.core.windows.net`;
}

export function createContainerClient(target: BlobTarget): ContainerClient {
  return new BlobServiceClient(accountUrl(target.account), target.credential).getContainerClient(
    target.container
  );
}

function getTarget(): BlobTarget {
  return (
    override ?? {
      account: CONFIG.storage.account,
      container: CONFIG.storage.container,
      credential: getCredential(),
    }
  );
}

function getContainer(): ContainerClient {
  container ??= createContainerClient(getTarget());
  return container;
}

/** Points the blob functions at another container (local scripts). Returns a reset function. */
export function useBlobStorage(target: BlobTarget): () => void {
  override = target;
  container = undefined;
  delegationKey = undefined;
  return () => {
    override = undefined;
    container = undefined;
    delegationKey = undefined;
  };
}

function isNotFound(error: unknown): boolean {
  return (error as { statusCode?: unknown })?.statusCode === 404;
}

export async function putBlob(name: string, bytes: Uint8Array, contentType: string): Promise<void> {
  await getContainer()
    .getBlockBlobClient(name)
    .uploadData(bytes, { blobHTTPHeaders: { blobContentType: contentType } });
}

/** The content of a blob, or undefined if it does not exist. */
export async function getBlob(name: string): Promise<Buffer | undefined> {
  try {
    return await getContainer().getBlockBlobClient(name).downloadToBuffer();
  } catch (error: unknown) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

/** Deletes all blobs whose name starts with `prefix`; returns how many were deleted. */
export async function deleteBlobs(prefix: string): Promise<number> {
  if (!prefix.endsWith('/')) throw new Error(`Blob prefix must end with a slash: ${prefix}`);
  const client = getContainer();
  let deleted = 0;
  for await (const blob of client.listBlobsFlat({ prefix })) {
    try {
      await client.deleteBlob(blob.name, { deleteSnapshots: 'include' });
      deleted++;
    } catch (error: unknown) {
      // Deleted in the meantime, e.g. by a concurrent request
      if (!isNotFound(error)) throw error;
    }
  }
  return deleted;
}

// --- Short-lived links (Mitschriften) ---

/** Delegation keys are valid for up to seven days; one is reused while it lasts. */
const DELEGATION_KEY_HOURS = 25;
let delegationKey: { key: UserDelegationKey; account: string; expiresOn: number } | undefined;

async function getDelegationKey(target: BlobTarget, until: Date): Promise<UserDelegationKey> {
  const now = Date.now();
  if (
    !delegationKey ||
    delegationKey.account !== target.account ||
    delegationKey.expiresOn < until.getTime()
  ) {
    // Starts a little in the past, so clocks that are a few minutes apart do not matter
    const startsOn = new Date(now - 5 * 60_000);
    const expiresOn = new Date(now + DELEGATION_KEY_HOURS * 3_600_000);
    const service = new BlobServiceClient(accountUrl(target.account), target.credential);
    delegationKey = {
      key: await service.getUserDelegationKey(startsOn, expiresOn),
      account: target.account,
      expiresOn: expiresOn.getTime(),
    };
  }
  return delegationKey.key;
}

/**
 * A SAS URL of one blob, signed with a user delegation key of the app registration (the
 * accounts allow no shared keys). `permissions` as in `BlobSASPermissions.parse`.
 */
async function signedBlobUrl(name: string, permissions: string, minutes: number): Promise<string> {
  const target = getTarget();
  const expiresOn = new Date(Date.now() + minutes * 60_000);
  const key = await getDelegationKey(target, expiresOn);
  const query = generateBlobSASQueryParameters(
    {
      containerName: target.container,
      blobName: name,
      permissions: BlobSASPermissions.parse(permissions),
      startsOn: new Date(Date.now() - 5 * 60_000),
      expiresOn,
      protocol: SASProtocol.Https,
    },
    key,
    target.account
  ).toString();
  const path = `${encodeURIComponent(target.container)}/${name.split('/').map(encodeURIComponent).join('/')}`;
  return `${accountUrl(target.account)}/${path}?${query}`;
}

/**
 * A URL the browser can upload one new blob to: create and write (with tags) only, no reading
 * or listing, valid for `minutes`.
 */
export function createUploadUrl(name: string, minutes: number): Promise<string> {
  return signedBlobUrl(name, 'cwt', minutes);
}

/** A URL that lets a service (Azure Speech) read one blob for `minutes`. */
export function createReadUrl(name: string, minutes: number): Promise<string> {
  return signedBlobUrl(name, 'r', minutes);
}

/** Size of a blob in bytes, or undefined if it does not exist. Never reads its content. */
export async function getBlobSize(name: string): Promise<number | undefined> {
  try {
    return (await getContainer().getBlockBlobClient(name).getProperties()).contentLength;
  } catch (error: unknown) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

const STORAGE_API_VERSION = '2023-11-03';

/**
 * Deletes a blob for good. With soft delete switched on (production) a deleted blob could be
 * restored for days; the second request removes it for good (`deletetype=permanent`, allowed
 * on the account and granted to the app by the role „Storage Blob Permanent Delete“). A blob
 * that does not exist is fine.
 */
export async function deleteBlobPermanently(name: string): Promise<void> {
  const target = getTarget();
  const blob = getContainer().getBlockBlobClient(name);
  await blob.deleteIfExists({ deleteSnapshots: 'include' });
  const token = await target.credential.getToken('https://storage.azure.com/.default');
  if (!token) throw new Error('Failed to acquire a storage access token');
  const response = await fetch(`${blob.url}?deletetype=permanent`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'x-ms-version': STORAGE_API_VERSION,
      'x-ms-date': new Date().toUTCString(),
    },
  });
  // 404: gone already, or the account keeps no deleted blobs (previews); 409: soft delete is off
  if (!response.ok && response.status !== 404 && response.status !== 409) {
    throw new Error(`Permanent delete of a blob failed: ${response.status}`);
  }
}
