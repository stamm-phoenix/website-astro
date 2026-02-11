import {
    HttpRequest,
    HttpResponseInit,
    InvocationContext
} from "@azure/functions";
import {generateETag, isNotModified} from "./etag";

type EndpointHandler = (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>;

const CACHE_CONTROL = "public, max-age=86400, s-maxage=86400";

type TagAndDataGenerator<T> = (request: HttpRequest, context: InvocationContext) => Promise<{ tags: string[]; data: T }>;
type DataEndpointHandler<T> = (request: HttpRequest, context: InvocationContext, data: T) => Promise<HttpResponseInit>;

export function withEtag<T>(
    handler: DataEndpointHandler<T>,
    generateTagsAndData: TagAndDataGenerator<T>
): EndpointHandler {
    return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
        const { tags, data } = await generateTagsAndData(request, context);
        const currentETag = generateETag(tags);
        const requestETag = request.headers.get("if-none-match");

        if (isNotModified(requestETag, currentETag)) {
            return {
                status: 304,
                headers: {
                    "ETag": currentETag,
                    "Cache-Control": CACHE_CONTROL,
                },
            };
        }

        const response = await handler(request, context, data);

        if (response.status === 200) {
            response.headers = {
                ...response.headers,
                "ETag": currentETag,
                "Cache-Control": CACHE_CONTROL,
            };
        }

        return response;
    };
}

export function withErrorHandling(handler: EndpointHandler): EndpointHandler {
    return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
        try {
            return await handler(request, context);
        } catch (error: unknown) {
            context.error(error); // Log the raw unknown error
            let errorMessage = "Internal Server Error";
            let errorName = "Error";
            // let errorStack: string | undefined = undefined; // For optional stack

            if (error instanceof Error) {
                errorName = error.name;
                errorMessage = error.message;
                // errorStack = error.stack;
            } else if (typeof error === "string") {
                errorMessage = error;
            } else {
                errorMessage = String(error);
            }

            return {
                status: 500,
                jsonBody: {
                    error: errorName,
                    message: errorMessage,
                    // stack: errorStack,
                },
            };
        }
    };
}

export async function proxyFile(
    url: string,
    request: HttpRequest,
    context: InvocationContext,
    options?: {
        contentType?: string;
        contentDisposition?: string;
        token?: string; // For authenticated requests, e.g., SharePoint
    }
): Promise<HttpResponseInit> {
    const headers: Record<string, string> = {};

    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch) {
        headers["If-None-Match"] = ifNoneMatch;
    }

    if (options?.token) {
        headers["Authorization"] = `Bearer ${options.token}`;
    }

    const response = await fetch(url, {
        method: "GET",
        headers: headers,
    });

    if (response.status === 304) {
        const etag = response.headers.get("ETag");
        const headers: Record<string, string> = {
            "Cache-Control": CACHE_CONTROL,
        };
        if (etag) {
            headers["ETag"] = etag;
        }
        return {
            status: 304,
            headers: headers,
        };
    }

    if (!response.ok) {
        context.error(`Failed to fetch file from upstream: ${response.status} ${response.statusText} from ${url}`);
        return {
            status: response.status === 404 ? 404 : 502,
            body: "Failed to fetch file from upstream source",
        };
    }

    const arrayBuffer = await response.arrayBuffer();
    const etag = response.headers.get("ETag");
    const responseContentType = options?.contentType || response.headers.get("Content-Type") || "application/octet-stream";

    const responseHeaders: Record<string, string> = {
        "Content-Type": responseContentType,
        "Cache-Control": CACHE_CONTROL,
    };

    if (options?.contentDisposition) {
        responseHeaders["Content-Disposition"] = options.contentDisposition;
    }

    if (etag) {
        responseHeaders["ETag"] = etag;
    }

    return {
        status: 200,
        body: Buffer.from(arrayBuffer),
        headers: responseHeaders,
    };
}
