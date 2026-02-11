import {cachedFetch} from "./cache";
import {getSharePointDriveRootChildren} from "./sharepoint-data-access";
import {EnvironmentVariable, getEnvironment} from "./environment";

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
    return cachedFetch("download-files-list", async () => {
        const SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID = getEnvironment(
            EnvironmentVariable.SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID,
        );

        const items = await getSharePointDriveRootChildren(SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID, {
            expand: "thumbnails"
        });

        const downloadFiles: DownloadFile[] = items.map((item: any): DownloadFile => {
            
            const thumbnails = {
                large: item.thumbnails[0].large.url,
                medium: item.thumbnails[0].medium.url,
                small: item.thumbnails[0].small.url,
            }
            
            return {
                id: item.id,
                eTag: item.eTag,
                size: item.size,
                fileName: item.name,
                mimeType: item.file.mimeType,
                downloadUrl: item["@microsoft.graph.downloadUrl"],
                createdBy: item.createdBy?.user?.displayName ?? "Unbekannt",
                createdAt: item.createdDateTime,
                lastModifiedBy: item.lastModifiedBy?.user?.displayName ?? "Unbekannt",
                lastModifiedAt: item.lastModifiedDateTime,
                thumbnails: thumbnails,
            };
        });

        return downloadFiles;
    }, 300);
}