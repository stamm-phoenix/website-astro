import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getAktionen, isLeitendeOnly, Aktion} from "../lib/aktionen-list";
import {buildIcs} from "../lib/ics-builder";
import {withErrorHandling, withEtag} from "../lib/response-utils";

export async function GetLeitendeIcsEndpointInternal(
    request: HttpRequest,
    context: InvocationContext,
    filteredAktionen: Aktion[] // Now accepts filteredAktionen
): Promise<HttpResponseInit> {
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
        .filter((a) => isLeitendeOnly(a));
    return {
        tags: filteredAktionen.map(a => a.eTag),
        data: filteredAktionen
    };
}));
