import type { DownloadFile } from './types/oeffentlich';
import { bakedUrl } from './bakedImages';
import { createResource } from './resource.svelte';
import { loadStateOf } from './storeView';

/** Newest first; also applied to the data baked at build time. */
export function sortDownloads(data: DownloadFile[]): DownloadFile[] {
  return [...data].sort((a, b) => Date.parse(b.lastModifiedAt) - Date.parse(a.lastModifiedAt));
}

const downloads = createResource<DownloadFile[]>('/downloads', { transform: sortDownloads });

export const downloadsStore = loadStateOf(downloads.state);

/** Asks again on every call, unless a request is already running, which is joined. */
export function fetchDownloads(): Promise<void> {
  return downloads.load({ maxAge: 0 });
}

export function getDownloadPreviewUrl(
  id: string,
  size: 'small' | 'medium' | 'large' = 'medium'
): string {
  return bakedUrl(`/api/downloads/${id}/image/${size}`);
}

export function getDownloadFileUrl(id: string): string {
  return `/api/downloads/${id}/file`;
}

const SIZE_NUMBER = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/** A file size in German notation, e.g. `29,5 KB`. */
export function formatFileSize(bytes: number): string {
  bytes = Math.max(0, Number(bytes) || 0);
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  let i = Math.floor(Math.log(bytes) / Math.log(k));
  i = Math.min(Math.max(i, 0), sizes.length - 1);
  return `${SIZE_NUMBER.format(bytes / Math.pow(k, i))} ${sizes[i]}`;
}
