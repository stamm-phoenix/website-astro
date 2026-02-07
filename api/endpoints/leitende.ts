import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getLeitende, Leitende} from "../lib/leitende-list";

interface LeitendeData {
    id: string;
    name: string;
    teams: string[];
    hasImage: boolean;
}

export async function GetLeitendeEndpoint(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
    try {
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

export default GetLeitendeEndpoint;
