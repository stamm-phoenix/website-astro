import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getAktionen} from "../lib/aktionen-list";
import {buildIcs} from "../lib/ics-builder";

export async function GetAktionenIcsEndpoint(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
    try {
        const aktionen = await getAktionen();

        const filteredAktionen = aktionen
            .filter((a) => !(a.stufen.length === 1 && a.stufen.every(s => s === "Leitende")));

        const icsBody = buildIcs(filteredAktionen, "DPSG Stamm Phoenix - Aktionen");

        return {
            status: 200,
            body: icsBody,
            headers: {
                "Content-Type": "text/calendar; charset=utf-8",
                "Content-Disposition": 'attachment; filename="aktionen.ics"',
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
