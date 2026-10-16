import { BlobServiceClient } from '@azure/storage-blob';
import type { ContainerClient } from '@azure/storage-blob';
import type { TokenCredential } from '@azure/identity';
import type { Readable } from 'node:stream';
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

export interface BlobInfo {
  name: string;
  lastModified: Date;
}

/** Name and time of the last change of all blobs whose name starts with `prefix`. */
export async function listBlobs(prefix: string): Promise<BlobInfo[]> {
  const result: BlobInfo[] = [];
  for await (const blob of getContainer().listBlobsFlat({ prefix })) {
    result.push({ name: blob.name, lastModified: blob.properties.lastModified });
  }
  return result;
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

/** Deletes one blob; a missing blob is ignored. */
export async function deleteBlob(name: string): Promise<void> {
  try {
    await getContainer().deleteBlob(name, { deleteSnapshots: 'include' });
  } catch (error: unknown) {
    if (!isNotFound(error)) throw error;
  }
}

/** Stores a stream as a blob, without holding it in memory. */
export async function putBlobStream(
  name: string,
  stream: NodeJS.ReadableStream,
  contentType: string
): Promise<void> {
  await getContainer()
    .getBlockBlobClient(name)
    .uploadStream(stream as Readable, 4 * 1024 * 1024, 4, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
}

/**
 * Stages one part of a blob uploaded in parts; `commitStagedBlob` puts them together. Parts that
 * are never committed expire after 7 days.
 */
export async function stageBlobPart(name: string, index: number, bytes: Uint8Array): Promise<void> {
  await getContainer().getBlockBlobClient(name).stageBlock(partId(index), bytes, bytes.length);
}

/** Block IDs must all have the same length; the index sorts them. */
function partId(index: number): string {
  return Buffer.from(`part-${String(index).padStart(6, '0')}`).toString('base64');
}

export interface StagedPart {
  index: number;
  size: number;
}

/** The staged parts of a blob, sorted by index. */
export async function listStagedParts(name: string): Promise<StagedPart[]> {
  let list;
  try {
    list = await getContainer().getBlockBlobClient(name).getBlockList('uncommitted');
  } catch (error: unknown) {
    if (isNotFound(error)) return [];
    throw error;
  }
  return (list.uncommittedBlocks ?? [])
    .flatMap((block) => {
      const match = /^part-(\d{6})$/.exec(Buffer.from(block.name, 'base64').toString());
      return match ? [{ index: Number(match[1]), size: block.size }] : [];
    })
    .sort((a, b) => a.index - b.index);
}

/**
 * Puts the parts `0 … count - 1` together into the blob. Returns false if the blob exists
 * already: a part never replaces a stored file, and of two requests completing the same upload
 * only one succeeds (`If-None-Match: *`; staged parts alone do not count as a blob).
 */
export async function commitStagedBlob(
  name: string,
  count: number,
  contentType: string
): Promise<boolean> {
  try {
    await getContainer()
      .getBlockBlobClient(name)
      .commitBlockList(
        Array.from({ length: count }, (_, index) => partId(index)),
        { blobHTTPHeaders: { blobContentType: contentType }, conditions: { ifNoneMatch: '*' } }
      );
    return true;
  } catch (error: unknown) {
    const status = (error as { statusCode?: unknown })?.statusCode;
    if (status === 409 || status === 412) return false;
    throw error;
  }
}

/** A blob as a stream with its size, or undefined if it does not exist. */
export async function openBlob(
  name: string
): Promise<{ stream: NodeJS.ReadableStream; size: number } | undefined> {
  try {
    const response = await getContainer().getBlockBlobClient(name).download();
    if (!response.readableStreamBody) return undefined;
    return { stream: response.readableStreamBody, size: response.contentLength ?? 0 };
  } catch (error: unknown) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}
