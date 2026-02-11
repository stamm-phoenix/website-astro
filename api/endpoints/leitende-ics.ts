import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getAktionen, isLeitendeOnly} from "../lib/aktionen-list";
import {buildIcs} from "../lib/ics-builder";
import {withErrorHandling, withEtag} from "../lib/response-utils";

export async function GetLeitendeIcsEndpointInternal(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
    const aktionen = await getAktionen();

    const filteredAktionen = aktionen
        .filter((a) => isLeitendeOnly(a));

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
    return filteredAktionen.map(a => a.eTag);
}));
