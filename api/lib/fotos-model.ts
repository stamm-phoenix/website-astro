import type { FotoKind } from './foto-pfade';

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

/** `name` is the name the file has or gets in SharePoint; it can differ from the one asked for. */
export type FotoUploadSession =
  | { exists: true; name: string }
  | { exists: false; name: string; uploadUrl: string; expiresAt: string | null };
