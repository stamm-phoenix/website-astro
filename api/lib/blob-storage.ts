import { BlobServiceClient } from '@azure/storage-blob';
import type { ContainerClient } from '@azure/storage-blob';
import type { TokenCredential } from '@azure/identity';
import { CONFIG } from './config';
import { getCredential } from './token';

/**
 * Files in Azure Blob Storage (`CONFIG.storage`), e.g. the images of blog posts. The website
 * signs in with its app registration (role „Storage Blob Data Contributor“); the account
 * allows no public access and no shared keys. Blobs are only served through the API, which
 * checks first whether a file may be shown. See `docs/azure-sql.md`.
 */

export interface BlobTarget {
  account: string;
  container: string;
  credential: TokenCredential;
}

let container: ContainerClient | undefined;
let override: BlobTarget | undefined;

export function createContainerClient(target: BlobTarget): ContainerClient {
  return new BlobServiceClient(
    `https://${target.account}.blob.core.windows.net`,
    target.credential
  ).getContainerClient(target.container);
}

function getContainer(): ContainerClient {
  container ??= createContainerClient(
    override ?? {
      account: CONFIG.storage.account,
      container: CONFIG.storage.container,
      credential: getCredential(),
    }
  );
  return container;
}

/** Points the blob functions at another container (local scripts). Returns a reset function. */
export function useBlobStorage(target: BlobTarget): () => void {
  override = target;
  container = undefined;
  return () => {
    override = undefined;
    container = undefined;
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
