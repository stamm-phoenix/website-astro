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
    leitende: Leitende[]
): Promise<HttpResponseInit> {
    const data = leitende
        .map((l): LeitendeData => {
            return {
                id: l.id,
                name: l.name,
                teams: l.teams,
                hasImage: l.hasImage
            }
        });

    return {
        status: 200,
        jsonBody: data,
    };
}

export default withErrorHandling(withEtag(GetLeitendeEndpointInternal, async () => {
    const leitende = await getLeitende();
    return {
        tags: leitende.map(l => l.eTag),
        data: leitende
    };
}));
