import type { HttpResponseInit } from '@azure/functions';
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

/** The public list; who uploaded a file stays internal. */
export async function GetDownloadFilesEndpoint(): Promise<HttpResponseInit> {
  const files = await listDownloads();
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
