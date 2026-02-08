import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {BlogEntry, getBlogEntries} from "../lib/blog-list";
import {generateETag, isNotModified} from "../lib/etag";

interface BlogData {
    id: string;
    title: string;
    content: string;
    createdAt: string;
    createdBy: string;
    lastModifiedAt: string;
    lastModifiedBy: string;
    hasImage: boolean;
}

export async function GetBlogEndpoint(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
    try {
        const blogEntries: BlogEntry[] = await getBlogEntries();
        
        const currentETag = generateETag(blogEntries.map(b => b.eTag));
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

        const data = blogEntries
            .map((b): BlogData => {
                return {
                    id: b.id,
                    title: b.title,
                    content: b.content,
                    hasImage: b.hasImage,
                    createdBy: b.createdBy,
                    createdAt: b.createdAt,
                    lastModifiedBy: b.lastModifiedBy,
                    lastModifiedAt: b.lastModifiedAt
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

export default GetBlogEndpoint;
