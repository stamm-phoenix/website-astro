import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getAktionen} from "../lib/aktionen-list";
import {buildIcs} from "../lib/ics-builder";
import {withErrorHandling, withEtag} from "../lib/response-utils";

export async function GetLeitendeIcsEndpointInternal(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
    const aktionen = await getAktionen();

    const filteredAktionen = aktionen
        .filter((a) => a.stufen.length === 1 && a.stufen.every(s => s === "Leitende"));

    const icsBody = buildIcs(filteredAktionen, "DPSG Stamm Phoenix - Leitende");

    return {
        status: 200,
        body: icsBody,
        headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'attachment; filename="leitende.ics"',
        },
    };
}

export default withErrorHandling(withEtag(GetLeitendeIcsEndpointInternal, async () => {
    const aktionen = await getAktionen();
    const filteredAktionen = aktionen
        .filter((a) => a.stufen.length === 1 && a.stufen.every(s => s === "Leitende"));
    return filteredAktionen.map(a => a.eTag);
}));
