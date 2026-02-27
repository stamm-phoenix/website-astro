import type { HttpResponseInit } from '@azure/functions';
import { getDownloadFiles } from '../lib/download-files-list';
import { withErrorHandling } from '../lib/response-utils';

interface DownloadFileData {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  createdAt: string;
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
}

export async function GetDownloadFilesEndpoint(): Promise<HttpResponseInit> {
  const downloadFiles = await getDownloadFiles();

  const data = downloadFiles.map((d): DownloadFileData => {
    return {
      id: d.id,
      size: d.size,
      fileName: d.fileName,
      mimeType: d.mimeType,
      createdAt: d.createdAt,
      createdBy: d.createdBy,
      lastModifiedAt: d.lastModifiedAt,
      lastModifiedBy: d.lastModifiedBy,
    };
  });

  return {
    status: 200,
    jsonBody: data,
  };
}

export default withErrorHandling(GetDownloadFilesEndpoint);
