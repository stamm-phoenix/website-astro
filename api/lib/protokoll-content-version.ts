import { assertProtokollSize } from './protokoll-text';
import { createHash } from 'node:crypto';
import { readZipParts } from './zip';
import { DocxError } from './docx-text';
import type { ProtokollDriveItem } from './protokolle';
import { parseProtokollTermin } from './protokoll-termin';
import { getSharePointDriveFileContent, getSharePointDriveItem } from './sharepoint-data-access';
import {
  readProtokollContentVersions,
  saveProtokollContentVersions,
} from './protokoll-content-version-store';
import type { StoredContentVersion } from './protokoll-content-version-store';

const PREFIX = 'docx-word-sha256:';
const FILE_PREFIX = 'file-sha256:';
const isFingerprint = (value?: string): boolean =>
  !!value && (value.startsWith(PREFIX) || value.startsWith(FILE_PREFIX));

export function fileContentVersion(content: Uint8Array, fileName: string): string {
  return /\.docx$/i.test(fileName)
    ? docxContentVersion(content)
    : FILE_PREFIX + createHash('sha256').update(content).digest('hex');
}
const MAX_WORD_BYTES = 50 * 1024 * 1024;
const versions = new Map<string, { cTag: string; version: string }>();

/** Forgets the versions in memory, as after a restart (for tests). */
export function resetProtokollContentVersionCache(): void {
  versions.clear();
}

function warn(warning: string, error: unknown): void {
  console.warn(
    JSON.stringify({
      scope: 'protokoll-content-version',
      warning,
      error: error instanceof Error ? error.message : String(error),
    })
  );
}

/**
 * Retain one version per file in the current folder, with at most four Graph downloads. The
 * versions are also stored in Azure SQL, so a new process downloads only files whose cTag changed.
 */
export async function withProtokollContentVersions(
  driveId: string,
  items: ProtokollDriveItem[]
): Promise<ProtokollDriveItem[]> {
  const keys = new Set(items.map((item) => JSON.stringify([driveId, item.id])));
  for (const key of versions.keys()) {
    if (JSON.parse(key)[0] === driveId && !keys.has(key)) versions.delete(key);
  }
  let stored: Map<string, StoredContentVersion> | undefined;
  try {
    stored = await readProtokollContentVersions(driveId);
  } catch (error: unknown) {
    warn('Stored content versions could not be read; the files are downloaded', error);
  }
  for (const item of items) {
    const row = stored?.get(item.id);
    const key = JSON.stringify([driveId, item.id]);
    if (row && item.cTag && row.cTag === item.cTag && versions.get(key)?.cTag !== item.cTag)
      versions.set(key, row);
  }
  const result = new Array<ProtokollDriveItem>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        result[index] = await withProtokollContentVersion(driveId, items[index]);
      }
    })
  );
  if (stored) await storeContentVersions(driveId, items, stored);
  return result;
}

/** Writes during a GET: a failure is only logged, the next list stores the versions again. */
async function storeContentVersions(
  driveId: string,
  items: ProtokollDriveItem[],
  stored: Map<string, StoredContentVersion>
): Promise<void> {
  const changed = new Map<string, StoredContentVersion>();
  for (const item of items) {
    const cached = versions.get(JSON.stringify([driveId, item.id]));
    const row = stored.get(item.id);
    if (!item.cTag || cached?.cTag !== item.cTag) continue;
    if (row?.cTag !== cached.cTag || row.version !== cached.version) changed.set(item.id, cached);
  }
  const ids = new Set(items.map((item) => item.id));
  const removed = [...stored.keys()].filter((id) => !ids.has(id));
  if (changed.size === 0 && removed.length === 0) return;
  try {
    await saveProtokollContentVersions(driveId, changed, removed);
  } catch (error: unknown) {
    warn('Content versions could not be stored; the next list stores them again', error);
  }
}

/** SharePoint writes library columns into customXml and changes cTag, even without a Word edit. */
export function docxContentVersion(docx: Uint8Array): string {
  const parts = readZipParts(Buffer.from(docx), (name) => name.startsWith('word/'), MAX_WORD_BYTES);
  if (!parts.some((part) => part.name === 'word/document.xml'))
    throw new DocxError('Not a Word file');
  parts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(`${Buffer.byteLength(part.name)}:${part.name}:${part.data.length}:`);
    hash.update(part.data);
  }
  // Text, styles, headers, images and embedded objects are covered; library properties are not.
  return PREFIX + hash.digest('hex');
}

/** Old stored cTags remain conservative until the file is reviewed or recognized again. */
export function protokollContentVersion(item: ProtokollDriveItem, reference?: string): string {
  if (reference && !isFingerprint(reference)) return item.cTag ?? '';
  return item.contentVersion ?? item.cTag ?? '';
}

/** Only files with a stored content fingerprint need a download when listing minutes. */
export async function withProtokollContentVersion(
  driveId: string,
  item: ProtokollDriveItem,
  force = false
): Promise<ProtokollDriveItem> {
  const fields = item.metadata?.fields ?? item.listItem?.fields;
  const approval = fields?.FreigabeVersion;
  const source = parseProtokollTermin(fields?.Termin)?.sourceVersion;
  if (!force && !isFingerprint(approval) && !isFingerprint(source)) return item;
  const key = JSON.stringify([driveId, item.id]);
  const cached = versions.get(key);
  if (item.cTag && cached?.cTag === item.cTag) return { ...item, contentVersion: cached.version };
  try {
    assertProtokollSize(item.size);
    const docx = await getSharePointDriveFileContent(driveId, item.id);
    assertProtokollSize(docx.byteLength);
    const current = (await getSharePointDriveItem(driveId, item.id)) as
      ProtokollDriveItem | undefined;
    if (!current || current.cTag !== item.cTag) {
      return { ...item, contentVersion: '' };
    }
    const contentVersion = fileContentVersion(docx, item.name);
    if (item.cTag) versions.set(key, { cTag: item.cTag, version: contentVersion });
    return { ...item, contentVersion };
  } catch {
    // An unreadable file cannot validate a stored fingerprint. Detection still records its
    // own download/model error; approval requires a readable, unchanged file.
    return { ...item, contentVersion: '' };
  }
}
