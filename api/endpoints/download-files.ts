import {HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {DownloadFile, getDownloadFiles} from "../lib/download-files-list";
import {generateETag, isNotModified} from "../lib/etag";

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

export async function GetDownloadFilesEndpoint(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
    try {
        const downloadFiles: DownloadFile[] = await getDownloadFiles();

        const currentETag = generateETag(downloadFiles.map(b => b.eTag));
        const requestETag = request.headers.get("if-none-match");

        if (isNotModified(requestETag, currentETag)) {
            return {
                status: 304,
                headers: {
                    "ETag": currentETag,
                    "Cache-Control": "public, max-age=3600, s-maxage=3600",
                },
            };
        }

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
            headers: {
                "ETag": currentETag,
                "Cache-Control": "public, max-age=3600, s-maxage=3600",
            },
        };
    } catch (error: any) {
        context.error(error);
        return {
            status: 500,
            jsonBody: {
                error: error.name || "Error",
                message: error.message || "Internal Server Error",
                // stack: error.stack,
            },
        };
    }
}

export default GetDownloadFilesEndpoint;
