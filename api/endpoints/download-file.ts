import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getDownloadFiles} from "../lib/download-files-list";

export async function GetDownloadFileEndpoint(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
    try {
        const itemId = request.params.id;
        if (!itemId) {
            return {
                status: 400,
                body: "No item ID provided",
            };
        }

        const downloadFiles = await getDownloadFiles();

        const item = downloadFiles.find((d) => d.id === itemId);

        if (!item) {
            return {
                status: 404,
                body: `File with ID ${itemId} not found`,
            };
        }
        
        const fileUrl = item.downloadUrl;

        if (!fileUrl) {
            context.error(`No download URL found for file ${itemId}`);
            return {
                status: 500,
                body: "Download URL not available",
            };
        }

        const headers: Record<string, string> = {};

        const ifNoneMatch = request.headers.get("if-none-match");
        if (ifNoneMatch) {
            headers["If-None-Match"] = ifNoneMatch;
        }

        const response = await fetch(fileUrl, {
            method: "GET",
            headers: headers,
        });

        const CACHE_CONTROL = "public, max-age=86400, s-maxage=86400";

        if (response.status === 304) {
            return {
                status: 304,
                headers: {
                    "ETag": response.headers.get("ETag") || "",
                    "Cache-Control": CACHE_CONTROL,
                },
            };
        }

        if (!response.ok) {
            context.error(`Failed to fetch file from SharePoint: ${response.status} ${response.statusText}`);
            return {
                status: response.status === 404 ? 404 : 502,
                body: "Failed to fetch file from upstream source",
            };
        }

        const arrayBuffer = await response.arrayBuffer();
        const contentType = item.mimeType || "application/octet-stream";
        const etag = response.headers.get("ETag");

        const responseHeaders: Record<string, string> = {
            "Content-Type": contentType,
            "Cache-Control": CACHE_CONTROL,
            "Content-Disposition": `attachment; filename="${item.fileName}"`,
        };

        if (etag) {
            responseHeaders["ETag"] = etag;
        }

        return {
            status: 200,
            body: Buffer.from(arrayBuffer),
            headers: responseHeaders,
        };
    } catch (error: any) {
        context.error(error);
        return {
            status: 500,
            jsonBody: {
                error: error.name || "Error",
                message: error.message || "Internal Server Error",
            },
        };
    }
}

export default GetDownloadFileEndpoint;
