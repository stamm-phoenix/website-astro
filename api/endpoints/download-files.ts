import type { HttpResponseInit } from '@azure/functions';
import { downloadsTakenOver, readSharePointDownloads } from '../lib/download-import';
import type { StoredDownload } from '../lib/downloads';
import { listDownloads } from '../lib/downloads';
import { withErrorHandling } from '../lib/response-utils';

interface DownloadFileData {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  hasPreview: boolean;
  createdAt: string;
  lastModifiedAt: string;
}

/**
 * The public list; who uploaded a file stays internal. It never copies files from SharePoint
 * (only the Pflege module does, `download-import.ts`), so it stays fast for the content build.
 */
export async function GetDownloadFilesEndpoint(): Promise<HttpResponseInit> {
  const files: StoredDownload[] = (await downloadsTakenOver())
    ? await listDownloads()
    : await readSharePointDownloads();

  return {
    status: 200,
    jsonBody: files.map((file): DownloadFileData => ({
      id: file.id,
      fileName: file.fileName,
      size: file.size,
      mimeType: file.mimeType,
      hasPreview: file.hasPreview,
      createdAt: file.createdAt,
      lastModifiedAt: file.lastModifiedAt,
    })),
  };
}

export default withErrorHandling(GetDownloadFilesEndpoint);
