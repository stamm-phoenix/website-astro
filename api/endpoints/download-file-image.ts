import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getDownloadFiles} from "../lib/download-files-list";
import {withErrorHandling, proxyFile} from "../lib/response-utils";

export async function GetDownloadFileImageEndpointInternal(
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

    console.log(imageUrl); // Keep console.log for debugging purposes

    return await proxyFile(imageUrl, request, context, {
        contentType: "image/jpeg",
    });
}

export default withErrorHandling(GetDownloadFileImageEndpointInternal);
