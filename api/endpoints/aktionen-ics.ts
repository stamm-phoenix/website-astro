import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getAktionen} from "../lib/aktionen-list";
import {buildIcs} from "../lib/ics-builder";
import {withErrorHandling, withEtag} from "../lib/response-utils";

export async function GetAktionenIcsEndpointInternal(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
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
}

export default withErrorHandling(withEtag(GetAktionenIcsEndpointInternal, async () => {
    const aktionen = await getAktionen();
    const filteredAktionen = aktionen
        .filter((a) => !(a.stufen.length === 1 && a.stufen.every(s => s === "Leitende")));
    return filteredAktionen.map(a => a.eTag);
}));
