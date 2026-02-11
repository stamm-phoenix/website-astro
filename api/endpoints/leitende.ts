import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getLeitende, Leitende} from "../lib/leitende-list";
import {withErrorHandling, withEtag} from "../lib/response-utils";

interface LeitendeData {
    id: string;
    name: string;
    teams: string[];
    hasImage: boolean;
}

export async function GetLeitendeEndpointInternal(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
    const leitende: Leitende[] = await getLeitende();

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
    };
}

export default withErrorHandling(withEtag(GetLeitendeEndpointInternal, async () => {
    const leitende = await getLeitende();
    return leitende.map(l => l.eTag);
}));
