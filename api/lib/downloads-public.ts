import { listDownloads, type StoredDownload } from './downloads';

export interface PublicDownload {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  hasPreview: boolean;
  category: string;
  createdAt: string;
  lastModifiedAt: string;
}

export function toPublicDownload(file: StoredDownload): PublicDownload {
  return {
    id: file.id,
    fileName: file.fileName,
    size: file.size,
    mimeType: file.mimeType,
    hasPreview: file.hasPreview,
    category: file.category,
    createdAt: file.createdAt,
    lastModifiedAt: file.lastModifiedAt,
  };
}

/** Selected public metadata; deleted files are omitted. */
export async function getPublicDownloads(ids: readonly string[]): Promise<PublicDownload[]> {
  const files = new Map((await listDownloads()).map((file) => [file.id, file]));
  return [...new Set(ids)].flatMap((id) => {
    const file = files.get(id);
    return file ? [toPublicDownload(file)] : [];
  });
}
