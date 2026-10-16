import { CONFIG } from './config';
import { fotoKind, splitFotoPath, type FotoKind } from './foto-pfade';
import {
  collectGraphCollectionPages,
  encodeDrivePath,
  getDrivePath,
  getGraphStatus,
  getSharePointDriveIdByName,
  getSharePointDriveItemPreviewUrl,
} from './sharepoint-data-access';
import { getClient } from './token';

// The photo library in SharePoint is the only store of the module „Fotos“: the API lists its
// folders, hands out short-lived links and upload sessions, and keeps nothing itself.

/** The site has no library `CONFIG.fotos.library`. */
export class FotoLibraryMissingError extends Error {
  constructor() {
    super(`The SharePoint site has no library "${CONFIG.fotos.library}".`);
    this.name = 'FotoLibraryMissingError';
  }
}

/** A file is in the way of a folder that should be created. */
export class FotoPathConflictError extends Error {
  constructor(public path: string) {
    super(`"${path}" is a file, not a folder.`);
    this.name = 'FotoPathConflictError';
  }
}

export interface FotoFolder {
  name: string;
  /** Path inside the library, e.g. `2026/Sommerlager`. */
  path: string;
  /** Number of files and folders inside, if SharePoint reports it. */
  childCount: number | null;
  webUrl: string;
}

export interface FotoFile {
  id: string;
  name: string;
  size: number;
  kind: FotoKind;
  /** About 800 pixels on the long side; null if SharePoint has no preview for the file. */
  thumbnailUrl: string | null;
  /** When the photo or video was taken, from its metadata. */
  takenAt: string | null;
  modifiedAt: string | null;
  width: number | null;
  height: number | null;
  /** Length of a video in milliseconds. */
  durationMs: number | null;
  webUrl: string;
  /** Short-lived link that downloads the original without a SharePoint login (about an hour). */
  downloadUrl: string | null;
}

export interface FotoFolderContent {
  /** Empty for the top folder of the library. */
  path: string;
  name: string;
  webUrl: string;
  folders: FotoFolder[];
  files: FotoFile[];
}

export interface FotoFileDetail {
  id: string;
  name: string;
  kind: FotoKind;
  /** A large version (up to 1920 pixels) for the detail view. */
  imageUrl: string | null;
  downloadUrl: string | null;
  /** Read-only player of SharePoint for videos, without a SharePoint login. */
  embedUrl: string | null;
  webUrl: string;
}

export type FotoUploadSession =
  { exists: true; name: string } | { exists: false; uploadUrl: string; expiresAt: string | null };

interface GraphThumbnail {
  url?: unknown;
}

interface GraphItem {
  id?: unknown;
  name?: unknown;
  size?: unknown;
  webUrl?: unknown;
  lastModifiedDateTime?: unknown;
  file?: { mimeType?: unknown };
  folder?: { childCount?: unknown };
  image?: { width?: unknown; height?: unknown };
  photo?: { takenDateTime?: unknown };
  video?: { duration?: unknown; width?: unknown; height?: unknown };
  parentReference?: { path?: unknown };
  thumbnails?: Record<string, GraphThumbnail | undefined>[];
  '@microsoft.graph.downloadUrl'?: unknown;
}

/** Graph requests of this module; a seam for the tests. */
export const fotoGraph = {
  async get(path: string, query: Record<string, string> = {}): Promise<unknown> {
    let request = getClient().api(path);
    if (Object.keys(query).length) request = request.query(query);
    return request.get();
  },
  async getAll(path: string, query: Record<string, string> = {}): Promise<unknown[]> {
    const client = getClient();
    const first: unknown = await fotoGraph.get(path, query);
    return collectGraphCollectionPages(first, async (nextLink) => client.api(nextLink).get());
  },
  async post(path: string, body: unknown): Promise<unknown> {
    return getClient().api(path).post(body);
  },
  previewUrl(driveId: string, itemId: string): Promise<string> {
    return getSharePointDriveItemPreviewUrl(driveId, itemId);
  },
  driveId(): Promise<string | undefined> {
    return getSharePointDriveIdByName(CONFIG.fotos.library);
  },
};

async function fotoDrive(): Promise<string> {
  const id = await fotoGraph.driveId();
  if (!id) throw new FotoLibraryMissingError();
  return id;
}

/** Graph path of a folder or file given by its path inside the library. */
function itemRef(driveId: string, path: string): string {
  const drive = getDrivePath(driveId);
  return path ? `${drive}/root:/${encodeDrivePath(path)}:` : `${drive}/root`;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Path of an item inside the library from its `parentReference.path`
 * (`/drives/…/root:/2026/Sommerlager`) and its name, with the names as SharePoint stores them.
 */
export function graphItemPath(item: GraphItem): string {
  const parent = text(item.parentReference?.path) ?? '';
  const marker = parent.indexOf('root:');
  const parentPath = marker >= 0 ? decodeURIComponent(parent.slice(marker + 5)) : '';
  return [...parentPath.split('/').filter(Boolean), text(item.name) ?? ''].join('/');
}

function thumbnail(item: GraphItem, size: string): string | null {
  const set = item.thumbnails?.[0];
  return text(set?.[size]?.url);
}

/** Year folders first and newest first, everything else in natural order. */
function compareFolders(a: FotoFolder, b: FotoFolder): number {
  const yearA = /^\d{4}$/.test(a.name);
  const yearB = /^\d{4}$/.test(b.name);
  if (yearA && yearB) return b.name.localeCompare(a.name);
  if (yearA !== yearB) return yearA ? -1 : 1;
  return a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });
}

function compareFiles(a: FotoFile, b: FotoFile): number {
  return a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });
}

export function toFotoFolder(item: GraphItem, parentPath: string): FotoFolder | null {
  const name = text(item.name);
  if (!name || !item.folder) return null;
  return {
    name,
    path: parentPath ? `${parentPath}/${name}` : name,
    childCount: count(item.folder.childCount),
    webUrl: text(item.webUrl) ?? '',
  };
}

export function toFotoFile(item: GraphItem): FotoFile | null {
  const id = text(item.id);
  const name = text(item.name);
  if (!id || !name || !item.file) return null;
  const kind = fotoKind(name);
  return {
    id,
    name,
    size: count(item.size) ?? 0,
    kind,
    thumbnailUrl: thumbnail(item, 'large') ?? thumbnail(item, 'medium'),
    takenAt: text(item.photo?.takenDateTime),
    modifiedAt: text(item.lastModifiedDateTime),
    width: count(item.image?.width) ?? count(item.video?.width),
    height: count(item.image?.height) ?? count(item.video?.height),
    durationMs: count(item.video?.duration),
    webUrl: text(item.webUrl) ?? '',
    downloadUrl: text(item['@microsoft.graph.downloadUrl']),
  };
}

async function findItem(driveId: string, path: string): Promise<GraphItem | undefined> {
  try {
    return (await fotoGraph.get(itemRef(driveId, path))) as GraphItem;
  } catch (error: unknown) {
    if (getGraphStatus(error) === 404) return undefined;
    throw error;
  }
}

/**
 * Folders and files of a folder of the library, with previews and download links.
 * @returns undefined if the folder does not exist (any more) or is a file.
 */
export async function listFotoFolder(path: string): Promise<FotoFolderContent | undefined> {
  const driveId = await fotoDrive();
  const folder = await findItem(driveId, path);
  if (!folder?.folder) return undefined;
  const children = (await fotoGraph.getAll(`${itemRef(driveId, path)}/children`, {
    $expand: 'thumbnails',
  })) as GraphItem[];
  const folderPath = path ? graphItemPath(folder) : '';
  return {
    path: folderPath,
    name: path ? (text(folder.name) ?? '') : CONFIG.fotos.library,
    webUrl: text(folder.webUrl) ?? '',
    folders: children
      .map((child) => toFotoFolder(child, folderPath))
      .filter((child): child is FotoFolder => child !== null)
      .sort(compareFolders),
    files: children
      .map(toFotoFile)
      .filter((child): child is FotoFile => child !== null)
      .sort(compareFiles),
  };
}

/** A file with a large version and, for videos, SharePoint's player. Undefined if missing. */
export async function getFotoFile(id: string): Promise<FotoFileDetail | undefined> {
  const driveId = await fotoDrive();
  const drive = getDrivePath(driveId);
  let item: GraphItem;
  try {
    item = (await fotoGraph.get(`${drive}/items/${encodeURIComponent(id)}`, {
      $expand: 'thumbnails',
    })) as GraphItem;
  } catch (error: unknown) {
    if (getGraphStatus(error) === 404) return undefined;
    throw error;
  }
  const file = toFotoFile(item);
  if (!file) return undefined;

  let imageUrl = file.thumbnailUrl;
  if (file.kind !== 'file') {
    try {
      const response = (await fotoGraph.get(`${drive}/items/${encodeURIComponent(id)}/thumbnails`, {
        select: 'c1920x1920',
      })) as { value?: Record<string, GraphThumbnail | undefined>[] };
      imageUrl = text(response.value?.[0]?.c1920x1920?.url) ?? imageUrl;
    } catch {
      // The preview of the list is good enough
    }
  }

  let embedUrl: string | null = null;
  if (file.kind === 'video') {
    try {
      embedUrl = await fotoGraph.previewUrl(driveId, id);
    } catch {
      // Without the player the video can still be downloaded or opened in SharePoint
    }
  }

  return {
    id: file.id,
    name: file.name,
    kind: file.kind,
    imageUrl,
    downloadUrl: file.downloadUrl,
    embedUrl,
    webUrl: file.webUrl,
  };
}

/**
 * Creates the folders of a path that do not exist yet. Existing folders are kept as they are,
 * also if their name differs in case.
 * @returns The path with the names as stored and the link to the folder in SharePoint.
 */
export async function ensureFotoFolder(path: string): Promise<{ path: string; webUrl: string }> {
  const segments = splitFotoPath(path);
  if (!segments?.length) throw new Error(`Invalid photo path "${path}"`);
  const driveId = await fotoDrive();

  const existing = await findItem(driveId, path);
  if (existing?.folder)
    return { path: graphItemPath(existing), webUrl: text(existing.webUrl) ?? '' };

  let parent = '';
  let webUrl = '';
  for (const segment of segments) {
    const current = parent ? `${parent}/${segment}` : segment;
    let item = await findItem(driveId, current);
    if (!item) {
      try {
        item = (await fotoGraph.post(`${itemRef(driveId, parent)}/children`, {
          name: segment,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        })) as GraphItem;
      } catch (error: unknown) {
        // Someone else created it in the meantime
        if (getGraphStatus(error) !== 409) throw error;
        item = await findItem(driveId, current);
      }
    }
    if (!item?.folder) throw new FotoPathConflictError(current);
    parent = parent ? `${parent}/${text(item.name) ?? segment}` : (text(item.name) ?? segment);
    webUrl = text(item.webUrl) ?? '';
  }
  return { path: parent, webUrl };
}

/**
 * Starts the upload of a file into a folder. The browser sends the file in parts directly to
 * the returned URL, without a login. A file of the same name and size counts as already
 * uploaded (e.g. a repeated upload, or the answer to the last part got lost); with another size
 * SharePoint gives the new file a free name instead of replacing the existing one.
 */
export async function createFotoUploadSession(
  folderPath: string,
  fileName: string,
  size: number
): Promise<FotoUploadSession> {
  const driveId = await fotoDrive();
  const filePath = `${folderPath}/${fileName}`;
  const existing = await findItem(driveId, filePath);
  if (existing?.file && count(existing.size) === size) {
    return { exists: true, name: text(existing.name) ?? fileName };
  }
  const session = (await fotoGraph.post(`${itemRef(driveId, filePath)}/createUploadSession`, {
    item: { '@microsoft.graph.conflictBehavior': 'rename' },
  })) as { uploadUrl?: unknown; expirationDateTime?: unknown };
  const uploadUrl = text(session.uploadUrl);
  if (!uploadUrl?.startsWith('https://')) {
    throw new Error('SharePoint did not return an upload URL.');
  }
  return { exists: false, uploadUrl, expiresAt: text(session.expirationDateTime) };
}
