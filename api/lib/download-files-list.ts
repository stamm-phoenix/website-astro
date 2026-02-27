import {
  getSharePointDriveRootChildren,
  getSharePointDriveItemDownloadUrl,
} from './sharepoint-data-access';
import { EnvironmentVariable, getEnvironment } from './environment';

export interface DownloadFile {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  downloadUrl?: string;
  createdAt: string;
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  thumbnails?: {
    large: string;
    medium: string;
    small: string;
  };
}

interface DriveItem {
  id: string;
  name: string;
  size: number;
  file?: { mimeType: string };
  '@microsoft.graph.downloadUrl'?: string;
  createdBy?: { user?: { displayName?: string } };
  createdDateTime: string;
  lastModifiedBy?: { user?: { displayName?: string } };
  lastModifiedDateTime: string;
  thumbnails?: Array<{
    large?: { url?: string };
    medium?: { url?: string };
    small?: { url?: string };
  }>;
}

export async function getDownloadFiles(): Promise<DownloadFile[]> {
  const SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID = getEnvironment(
    EnvironmentVariable.SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID
  );

  const items = await getSharePointDriveRootChildren(SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID, {
    expand: 'thumbnails',
  });

  const downloadFiles: DownloadFile[] = [];

  // Concurrency limit N=3
  const BATCH_SIZE = 3;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (item: unknown): Promise<DownloadFile | null> => {
        const driveItem = item as DriveItem;

        // (1) Filter/skip non-file items
        if (!driveItem.file) {
          return null;
        }

        // (2) Guard thumbnails
        let thumbnails: DownloadFile['thumbnails'] | undefined = undefined;
        if (
          driveItem.thumbnails &&
          driveItem.thumbnails.length > 0 &&
          driveItem.thumbnails[0].large?.url &&
          driveItem.thumbnails[0].medium?.url &&
          driveItem.thumbnails[0].small?.url
        ) {
          thumbnails = {
            large: driveItem.thumbnails[0].large.url,
            medium: driveItem.thumbnails[0].medium.url,
            small: driveItem.thumbnails[0].small.url,
          };
        }

        // (3) Perform follow-up Graph call if downloadUrl is missing
        let downloadUrl = driveItem['@microsoft.graph.downloadUrl'];
        if (!downloadUrl) {
          downloadUrl = await getSharePointDriveItemDownloadUrl(
            SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID,
            driveItem.id
          );
        }

        return {
          id: driveItem.id,
          size: driveItem.size,
          fileName: driveItem.name,
          mimeType: driveItem.file.mimeType,
          downloadUrl: downloadUrl,
          createdBy: driveItem.createdBy?.user?.displayName ?? 'Unbekannt',
          createdAt: driveItem.createdDateTime,
          lastModifiedBy: driveItem.lastModifiedBy?.user?.displayName ?? 'Unbekannt',
          lastModifiedAt: driveItem.lastModifiedDateTime,
          thumbnails: thumbnails,
        };
      })
    );

    for (const result of batchResults) {
      if (result !== null) {
        downloadFiles.push(result);
      }
    }
  }

  return downloadFiles;
}
