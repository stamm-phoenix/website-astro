import { cachedFetch } from './cache';
import { getSharePointDriveRootChildren } from './sharepoint-data-access';
import { EnvironmentVariable, getEnvironment } from './environment';

export interface DownloadFile {
  id: string;
  eTag: string;
  fileName: string;
  size: number;
  mimeType: string;
  downloadUrl: string;
  createdAt: string;
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  thumbnails: {
    large: string;
    medium: string;
    small: string;
  };
}

export async function getDownloadFiles(): Promise<DownloadFile[]> {
  return cachedFetch(
    'download-files-list',
    async () => {
      const SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID = getEnvironment(
        EnvironmentVariable.SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID
      );

      const items = await getSharePointDriveRootChildren(SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID, {
        expand: 'thumbnails',
      });

      const downloadFiles: DownloadFile[] = items.map((item: unknown): DownloadFile => {
        const driveItem = item as {
          id: string;
          eTag: string;
          name: string;
          size: number;
          file: { mimeType: string };
          '@microsoft.graph.downloadUrl': string;
          createdBy: { user: { displayName: string } };
          createdDateTime: string;
          lastModifiedBy: { user: { displayName: string } };
          lastModifiedDateTime: string;
          thumbnails: Array<{
            large: { url: string };
            medium: { url: string };
            small: { url: string };
          }>;
        };

        const thumbnails = {
          large: driveItem.thumbnails[0].large.url,
          medium: driveItem.thumbnails[0].medium.url,
          small: driveItem.thumbnails[0].small.url,
        };

        return {
          id: driveItem.id,
          eTag: driveItem.eTag,
          size: driveItem.size,
          fileName: driveItem.name,
          mimeType: driveItem.file.mimeType,
          downloadUrl: driveItem['@microsoft.graph.downloadUrl'],
          createdBy: driveItem.createdBy?.user?.displayName ?? 'Unbekannt',
          createdAt: driveItem.createdDateTime,
          lastModifiedBy: driveItem.lastModifiedBy?.user?.displayName ?? 'Unbekannt',
          lastModifiedAt: driveItem.lastModifiedDateTime,
          thumbnails: thumbnails,
        };
      });

      return downloadFiles;
    },
    300
  );
}
