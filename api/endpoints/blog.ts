import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {BlogEntry, getBlogEntries} from "../lib/blog-list";

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
