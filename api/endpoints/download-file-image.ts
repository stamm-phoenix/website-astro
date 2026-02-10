import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getDownloadFiles} from "../lib/download-files-list";

export async function GetDownloadFileImageEndpoint(
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

        let size = request.params.size;
        if (size !== "large" && size !== "medium" && size !== "small") {
            return {
                status: 400,
                body: "Parameter size must be one of: large, medium, small",
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
        
        const imageUrl = item.thumbnails[size];

        console.log(imageUrl);
        
        const headers: Record<string, string> = {
            // Authorization: `Bearer ${token.token}`, // No auth
        };

        const ifNoneMatch = request.headers.get("if-none-match");
        if (ifNoneMatch) {
            headers["If-None-Match"] = ifNoneMatch;
        }

        const response = await fetch(imageUrl, {
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
            context.error(`Failed to fetch image from SharePoint: ${response.status} ${response.statusText}`);
            return {
                status: response.status === 404 ? 404 : 502,
                body: "Failed to fetch image from upstream source",
            };
        }

        const arrayBuffer = await response.arrayBuffer();
        const contentType = "image/jpeg";
        const etag = response.headers.get("ETag");

        const responseHeaders: Record<string, string> = {
            "Content-Type": contentType,
            "Cache-Control": CACHE_CONTROL,
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

export default GetDownloadFileImageEndpoint;
