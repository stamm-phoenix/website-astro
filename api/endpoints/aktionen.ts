import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getAktionen} from "../lib/aktionen-list";
import {withErrorHandling, withEtag} from "../lib/response-utils";

interface AktionData {
    id: string;
    stufen: string[];
    title: string;
    campflow_link?: string | undefined;
    description?: string | undefined;
    start: string;
    end: string;
}

export async function GetAktionenEndpointInternal(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
    const aktionen = await getAktionen();

    const filteredAktionen = aktionen
        .filter((a) => !(a.stufen.length === 1 && a.stufen.every(s => s === "Leitende")));

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
    };
}

export default withErrorHandling(withEtag(GetAktionenEndpointInternal, async () => {
    const aktionen = await getAktionen();
    const filteredAktionen = aktionen
        .filter((a) => !(a.stufen.length === 1 && a.stufen.every(s => s === "Leitende")));
    return filteredAktionen.map(a => a.eTag);
}));
