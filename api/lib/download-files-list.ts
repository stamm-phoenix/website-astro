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

export async function getDownloadFiles(): Promise<DownloadFile[]> {
  const SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID = getEnvironment(
    EnvironmentVariable.SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID
  );

  const items = await getSharePointDriveRootChildren(SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID, {
    expand: 'thumbnails',
  });

  const downloadFilesPromises = items.map(async (item: unknown): Promise<DownloadFile | null> => {
    const driveItem = item as {
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
    };

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
  });

  const downloadFiles = await Promise.all(downloadFilesPromises);

  // Return only non-null items
  return downloadFiles.filter((f): f is DownloadFile => f !== null);
}
