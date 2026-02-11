import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getDownloadFiles} from "../lib/download-files-list";
import {withErrorHandling, proxyFile} from "../lib/response-utils";

export async function GetDownloadFileEndpointInternal(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
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

    return await proxyFile(fileUrl, request, context, {
        contentType: item.mimeType || "application/octet-stream",
        contentDisposition: `attachment; filename="${item.fileName}"`,
    });
}

export default withErrorHandling(GetDownloadFileEndpointInternal);
