import {HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {DownloadFile, getDownloadFiles} from "../lib/download-files-list";
import {withErrorHandling, withEtag} from "../lib/response-utils";

interface DownloadFileData {
    id: string;
    eTag: string;
    fileName: string;
    size: number;
    mimeType: string;
    createdAt: string;
    createdBy: string;
    lastModifiedAt: string;
    lastModifiedBy: string;
}

export async function GetDownloadFilesEndpointInternal(
    request: HttpRequest,
    context: InvocationContext,
    downloadFiles: DownloadFile[]
): Promise<HttpResponseInit> {
    const data = downloadFiles
        .map((d): DownloadFileData => {
            return {
                id: d.id,
                eTag: d.eTag,
                size: d.size,
                fileName: d.fileName,
                mimeType: d.mimeType,
                createdAt: d.createdAt,
                createdBy: d.createdBy,
                lastModifiedAt: d.lastModifiedAt,
                lastModifiedBy: d.lastModifiedBy
            }
        });

    return {
        status: 200,
        jsonBody: data,
    };
}

export default withErrorHandling(withEtag(GetDownloadFilesEndpointInternal, async () => {
    const downloadFiles = await getDownloadFiles();
    return {
        tags: downloadFiles.map(b => b.eTag),
        data: downloadFiles
    };
}));
