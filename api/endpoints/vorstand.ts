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
            .filter(l => l.teams.includes("Vorstand"))
            .map((l): VorstandData => {
                return {
                    id: l.id,
                    name: l.name,
                    city: l.city,
                    street: l.street,
                    telephone: l.telephone,
                    hasImage: l.hasImage
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
                // stack: error.stack,
            },
        };
    }
}

export default GetVorstandEndpoint;
