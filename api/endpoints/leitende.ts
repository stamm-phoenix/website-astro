import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getLeitende, Leitende} from "../lib/leitende-list";
import {generateETag, isNotModified} from "../lib/etag";

interface LeitendeData {
    id: string;
    name: string;
    teams: string[];
    hasImage: boolean;
}

export async function GetLeitendeEndpoint(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
    try {
        const leitende: Leitende[] = await getLeitende();

        const currentETag = generateETag(leitende.map(l => l.eTag));
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

        const data = leitende
            .map((leitende): LeitendeData => {
                return {
                    id: leitende.id,
                    name: leitende.name,
                    teams: leitende.teams,
                    hasImage: leitende.hasImage
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

export default GetLeitendeEndpoint;
