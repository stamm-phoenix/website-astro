import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getLeitende, Leitende} from "../lib/leitende-list";

interface VorstandData {
    id: string;
    name: string;
    telephone: string | undefined;
    street: string | undefined;
    city: string | undefined;
    hasImage: boolean;
}

export async function GetVorstandEndpoint(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
    try {
        const leitende: Leitende[] = await getLeitende();

        const vorstaende = leitende
            .filter(leitende => leitende.teams.includes("Vorstand"))
            .map((leitende): VorstandData => {
                return {
                    id: leitende.id,
                    name: leitende.name,
                    city: leitende.city,
                    street: leitende.street,
                    telephone: leitende.telephone,
                    hasImage: leitende.hasImage
                }
            });

        return {
            status: 200,
            jsonBody: vorstaende,
        };
    } catch (error: any) {
        context.error(error);
        return {
            status: 500,
            jsonBody: {
                error: error.name || "Error",
                message: error.message || "Internal Server Error",
                stack: error.stack,
            },
        };
    }
}

export default GetVorstandEndpoint;
