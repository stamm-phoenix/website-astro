import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getAktionen} from "../lib/aktionen-list";
import {buildIcs} from "../lib/ics-builder";
import {generateETag, isNotModified} from "../lib/etag";

export async function GetAktionenIcsEndpoint(
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

        const icsBody = buildIcs(filteredAktionen, "DPSG Stamm Phoenix - Aktionen");

        return {
            status: 200,
            body: icsBody,
            headers: {
                "Content-Type": "text/calendar; charset=utf-8",
                "Content-Disposition": 'attachment; filename="aktionen.ics"',
                "ETag": currentETag,
                "Cache-Control": "public, max-age=3600, s-maxage=3600",
            },
        };
    } catch (error: any) {
        context.error(error);
        return {
            status: 500,
            body: "Internal Server Error",
        };
    }
}

export default GetAktionenIcsEndpoint;
