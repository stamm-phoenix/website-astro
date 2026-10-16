import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fotoKind, numberedName } from '../../../api/lib/foto-pfade';
import type { FotoFile, FotoFolder, FotoFolderContent } from '../../src/lib/types';

/**
 * The photo library of the mock API: folders and files in memory. Previews are SVGs in the
 * colour of the file; uploads are stored as bytes, so they can be downloaded again.
 */

interface MockFotoFile {
  id: string;
  path: string;
  size: number;
  takenAt: string | null;
  durationMs: number | null;
  hue: number;
  bytes: Uint8Array | null;
}

const BASE = '/api/mock-fotos';
const SAMPLE_VIDEO = fileURLToPath(new URL('./beispielvideo.webm', import.meta.url));
/** Folders with the time they were created; the seeds count up from the start of 2025. */
const folders = new Map<string, string>();
let created = Date.parse('2025-01-01T00:00:00Z');
const files = new Map<string, MockFotoFile>();
let counter = 0;

function addFolder(path: string): void {
  const segments = path.split('/');
  for (let i = 1; i <= segments.length; i++) {
    const folder = segments.slice(0, i).join('/');
    if (!folders.has(folder)) folders.set(folder, new Date((created += 86_400_000)).toISOString());
  }
}

function addFile(
  path: string,
  size: number,
  takenAt: string | null,
  durationMs: number | null = null
): MockFotoFile {
  addFolder(path.split('/').slice(0, -1).join('/'));
  const file: MockFotoFile = {
    id: `foto${++counter}`,
    path,
    size,
    takenAt,
    durationMs,
    hue: (counter * 47) % 360,
    bytes: null,
  };
  files.set(file.id, file);
  return file;
}

for (let i = 1; i <= 14; i++) {
  addFile(
    `Aktionen/2026/Sommerlager Westernohe/Nico/IMG_${String(4300 + i).padStart(4, '0')}.jpg`,
    2_400_000 + i * 51_000,
    `2026-07-${String(10 + (i % 5)).padStart(2, '0')}T1${i % 10}:30:00Z`
  );
}
addFile(
  'Aktionen/2026/Sommerlager Westernohe/Nico/VID_4320.mp4',
  48_000_000,
  '2026-07-12T18:00:00Z',
  83_000
);
for (let i = 1; i <= 5; i++) {
  addFile(
    `Aktionen/2026/Sommerlager Westernohe/Tom/DSC0${1200 + i}.ARW`,
    24_000_000,
    '2026-07-11T09:00:00Z'
  );
}
// Not in the wished structure: files directly in the Aktion folder
for (let i = 1; i <= 4; i++) {
  addFile(`Aktionen/2026/Herbstwanderung/PXL_2026101${i}.jpg`, 3_100_000, '2026-10-03T11:00:00Z');
}
addFolder('Aktionen/2025/Pfingstlager/Lisa');
for (let i = 1; i <= 6; i++) {
  addFile(
    `Aktionen/2025/Pfingstlager/Lisa/IMG_${2000 + i}.HEIC`,
    1_900_000,
    '2025-06-08T15:00:00Z'
  );
}
addFolder('Aktionen/2025/Schwedenfahrt 2025/Nico');
for (let i = 1; i <= 3; i++) {
  addFile(
    `Gruppenstunden/Wölflinge/2026-09-18 Waldtag/IMG_${5100 + i}.jpg`,
    2_000_000,
    '2026-09-18T16:00:00Z'
  );
}
addFile('Gruppenstunden/Fotoerlaubnis.pdf', 120_000, null);

function parentOf(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}

function nameOf(path: string): string {
  return path.split('/').pop() ?? path;
}

function webUrl(path: string): string {
  return `https://sharepoint.example/sites/leitende/Fotos/${path}`;
}

/** Finds a folder ignoring case, like SharePoint. */
function folderPath(path: string): string | undefined {
  if (path === '') return '';
  return [...folders.keys()].find((folder) => folder.toLowerCase() === path.toLowerCase());
}

function toFile(file: MockFotoFile): FotoFile {
  const kind = fotoKind(file.path);
  return {
    id: file.id,
    name: nameOf(file.path),
    size: file.size,
    kind,
    thumbnailUrl: kind === 'file' ? null : `${BASE}/vorschau/${file.id}`,
    takenAt: file.takenAt,
    modifiedAt: '2026-10-01T10:00:00Z',
    width: kind === 'file' ? null : 4032,
    height: kind === 'file' ? null : 3024,
    durationMs: file.durationMs,
    webUrl: webUrl(file.path),
    downloadUrl: `${BASE}/datei/${file.id}`,
  };
}

export function mockFotoFolder(path: string): FotoFolderContent | undefined {
  const actual = folderPath(path);
  if (actual === undefined) return undefined;
  const childFolders: FotoFolder[] = [...folders.keys()]
    .filter((folder) => parentOf(folder) === actual && folder !== '')
    .map((folder) => ({
      name: nameOf(folder),
      path: folder,
      childCount:
        [...folders.keys()].filter((f) => parentOf(f) === folder).length +
        [...files.values()].filter((f) => parentOf(f.path) === folder).length,
      createdAt: folders.get(folder) ?? null,
      webUrl: webUrl(folder),
    }))
    .sort((a, b) => {
      const yearA = /^\d{4}$/.test(a.name);
      const yearB = /^\d{4}$/.test(b.name);
      if (yearA && yearB) return b.name.localeCompare(a.name);
      if (yearA !== yearB) return yearA ? -1 : 1;
      // Like the API: below the top level newest first
      if (actual !== '' && a.createdAt !== b.createdAt) {
        return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
      }
      return a.name.localeCompare(b.name, 'de');
    });
  return {
    path: actual,
    name: actual ? nameOf(actual) : 'Fotos',
    webUrl: webUrl(actual),
    folders: childFolders,
    files: [...files.values()]
      .filter((file) => parentOf(file.path) === actual)
      .map(toFile)
      .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true })),
  };
}

export function mockFotoDetail(id: string) {
  const file = files.get(id);
  if (!file) return undefined;
  const view = toFile(file);
  return {
    id,
    name: view.name,
    kind: view.kind,
    imageUrl: view.thumbnailUrl ? `${view.thumbnailUrl}?gross=1` : null,
    downloadUrl: view.downloadUrl,
    embedUrl: null,
    webUrl: view.webUrl,
  };
}

export function mockFotoPreview(id: string, large: boolean): string | undefined {
  const file = files.get(id);
  if (!file) return undefined;
  const [width, height] = large ? [1600, 1200] : [400, 300];
  const name = nameOf(file.path).replace(/[<>&]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 400 300"><rect width="400" height="300" fill="hsl(${file.hue} 45% 55%)"/><circle cx="300" cy="80" r="40" fill="hsl(${(file.hue + 60) % 360} 70% 80%)"/><path d="M0 300 L120 150 L200 230 L270 170 L400 300Z" fill="hsl(${(file.hue + 180) % 360} 35% 35%)"/><text x="16" y="284" font-family="sans-serif" font-size="20" fill="#fff">${name}</text></svg>`;
}

export function mockFotoContent(id: string): Uint8Array | undefined {
  const file = files.get(id);
  if (!file) return undefined;
  if (file.bytes) return file.bytes;
  // A real short video, so the player of the large view can be tried out
  if (fotoKind(file.path) === 'video') return new Uint8Array(readFileSync(SAMPLE_VIDEO));
  return new TextEncoder().encode(mockFotoPreview(id, true));
}

/** Creates the missing folders of a path; null if a file is in the way. */
export function mockFotoEnsure(path: string): { path: string; webUrl: string } {
  const segments = path.split('/');
  let current = '';
  for (const segment of segments) {
    const next = current ? `${current}/${segment}` : segment;
    current = folderPath(next) ?? next;
    if (!folders.has(current)) folders.set(current, new Date().toISOString());
  }
  return { path: current, webUrl: webUrl(current) };
}

interface MockUploadSession {
  path: string;
  size: number;
  received: Uint8Array;
  next: number;
  /** Fails the second part once, to show the recovery (files with „wackel“ in the name). */
  flaky: boolean;
}

const sessions = new Map<string, MockUploadSession>();

export function mockFotoUploadSession(
  folder: string,
  name: string,
  size: number,
  { newName = false, reserved = [] as string[] } = {}
) {
  const actual = folderPath(folder) ?? folder;
  const skip = new Set(reserved.map((entry) => entry.toLowerCase()));
  // Like the API: a taken name gets the next free one, the same name and size counts as there
  for (let number = 0; number < 50; number++) {
    const candidate = number === 0 ? name : numberedName(name, number);
    if (skip.has(candidate.toLowerCase())) continue;
    const existing = [...files.values()].find(
      (file) => file.path.toLowerCase() === `${actual}/${candidate}`.toLowerCase()
    );
    if (existing) {
      if (!newName && number === 0 && existing.size === size)
        return { exists: true, name: nameOf(existing.path) };
      continue;
    }
    const id = `s${++counter}`;
    sessions.set(id, {
      path: `${actual}/${candidate}`,
      size,
      received: new Uint8Array(size),
      next: 0,
      flaky: name.toLowerCase().includes('wackel'),
    });
    return { exists: false, name: candidate, uploadUrl: `${BASE}/upload/${id}`, expiresAt: null };
  }
  return { exists: true, name };
}

/** A part of an upload: `Content-Range: bytes start-end/total`. */
export function mockFotoUploadPart(
  id: string,
  range: string | undefined,
  body: Uint8Array
): { status: number; body: unknown } {
  const session = sessions.get(id);
  if (!session) return { status: 404, body: { error: { code: 'itemNotFound' } } };
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range ?? '');
  if (!match) return { status: 400, body: { error: { code: 'invalidRange' } } };
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start !== session.next || end - start + 1 !== body.length) {
    return { status: 416, body: { nextExpectedRanges: [`${session.next}-`] } };
  }
  if (session.flaky && start > 0) {
    session.flaky = false;
    return { status: 503, body: { error: { code: 'serviceNotAvailable' } } };
  }
  session.received.set(body, start);
  session.next = end + 1;
  if (session.next < session.size) {
    return { status: 202, body: { nextExpectedRanges: [`${session.next}-`] } };
  }
  sessions.delete(id);
  let path = session.path;
  // Like SharePoint's conflict behaviour „rename“
  for (
    let n = 1;
    [...files.values()].some((f) => f.path.toLowerCase() === path.toLowerCase());
    n++
  ) {
    path = session.path.replace(/(\.[^./]+)?$/, (ext) => ` ${n}${ext}`);
  }
  const file = addFile(path, session.size, new Date().toISOString());
  file.bytes = session.received;
  return { status: 201, body: { id: file.id, name: nameOf(path), size: session.size } };
}

export function mockFotoUploadStatus(id: string): { status: number; body: unknown } {
  const session = sessions.get(id);
  if (!session) return { status: 404, body: { error: { code: 'itemNotFound' } } };
  return { status: 200, body: { nextExpectedRanges: [`${session.next}-`] } };
}
