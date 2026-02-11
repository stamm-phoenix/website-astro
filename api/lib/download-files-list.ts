import {getClient} from "./token";
import {EnvironmentVariable, getEnvironment} from "./environment";
import {cachedFetch} from "./cache";

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
        const client = getClient();

        const SHAREPOINT_HOST_NAME = getEnvironment(
            EnvironmentVariable.SHAREPOINT_HOST_NAME,
        );

        const SHAREPOINT_SITE_ID = getEnvironment(
            EnvironmentVariable.SHAREPOINT_SITE_ID,
        );

        const SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID = getEnvironment(
            EnvironmentVariable.SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID,
        );

        const response = await client
            .api(
                `/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/drives/${SHAREPOINT_DOWNLOAD_FILES_DRIVE_ID}/root/children`,
            )
            .expand("thumbnails")
            .get();

        const items = Array.isArray(response?.value) ? response.value : [];

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
    });
}