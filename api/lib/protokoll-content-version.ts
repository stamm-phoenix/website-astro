import { createHash } from 'node:crypto';
import { readZipParts } from './zip';
import { DocxError } from './docx-text';
import type { ProtokollDriveItem } from './protokolle';
import { parseProtokollTermin } from './protokoll-termin';
import {
  getSharePointDriveFileContent,
  getSharePointDriveItemWithFields,
} from './sharepoint-data-access';

const PREFIX = 'docx-word-sha256:';
const MAX_WORD_BYTES = 50 * 1024 * 1024;
const versions = new Map<string, { cTag: string; version: string }>();

/** Retain one version per file in the current folder, with at most four Graph downloads. */
export async function withProtokollContentVersions(
  driveId: string,
  items: ProtokollDriveItem[]
): Promise<ProtokollDriveItem[]> {
  const keys = new Set(items.map((item) => JSON.stringify([driveId, item.id])));
  for (const key of versions.keys()) {
    if (JSON.parse(key)[0] === driveId && !keys.has(key)) versions.delete(key);
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
  return result;
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
  if (reference && !reference.startsWith(PREFIX)) return item.cTag ?? '';
  return item.contentVersion ?? item.cTag ?? '';
}

/** Only files with a stored content fingerprint need a download when listing minutes. */
export async function withProtokollContentVersion(
  driveId: string,
  item: ProtokollDriveItem,
  force = false
): Promise<ProtokollDriveItem> {
  const approval = item.listItem?.fields?.FreigabeVersion;
  const source = parseProtokollTermin(item.listItem?.fields?.Termin)?.sourceVersion;
  if (!force && !approval?.startsWith(PREFIX) && !source?.startsWith(PREFIX)) return item;
  const key = JSON.stringify([driveId, item.id]);
  const cached = versions.get(key);
  if (item.cTag && cached?.cTag === item.cTag) return { ...item, contentVersion: cached.version };
  try {
    const docx = await getSharePointDriveFileContent(driveId, item.id);
    const current = (await getSharePointDriveItemWithFields(driveId, item.id)) as
      ProtokollDriveItem | undefined;
    if (!current || current.cTag !== item.cTag || current.listItem?.eTag !== item.listItem?.eTag) {
      return { ...item, contentVersion: '' };
    }
    const contentVersion = docxContentVersion(docx);
    if (item.cTag) versions.set(key, { cTag: item.cTag, version: contentVersion });
    return { ...item, contentVersion };
  } catch {
    // An unreadable file cannot validate a stored fingerprint. Detection still records its
    // own download/model error; approval requires a readable, unchanged file.
    return { ...item, contentVersion: '' };
  }
}
