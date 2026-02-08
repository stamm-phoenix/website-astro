import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getAktionen} from "../lib/aktionen-list";
import {generateETag, isNotModified} from "../lib/etag";

interface AktionData {
    id: string;
    stufen: string[];
    title: string;
    campflow_link?: string | undefined;
    description?: string | undefined;
    start: string;
    end: string;
}

export async function GetAktionenEndpoint(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
    try {
        const aktionen = await getAktionen();

        const filteredAktionen = aktionen
            .filter((a) => !(a.stufen.length === 1 && a.stufen.every(s => s === "Leitende")));

        const currentETag = generateETag(filteredAktionen.map(a => a.eTag));
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

        const data: AktionData[] = filteredAktionen.map(a => {
                return {
                    id: a.id,
                    stufen: a.stufen,
                    title: a.title,
                    campflow_link: a.campflow_link,
                    description: a.description,
                    start: a.start,
                    end: a.end
                }
            })

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

export default GetAktionenEndpoint;
