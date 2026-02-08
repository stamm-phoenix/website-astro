import {
    HttpRequest,
    InvocationContext,
    HttpResponseInit,
} from "@azure/functions";
import {getAktionen} from "../lib/aktionen-list";

interface AktionData {
    id: string;
    stufen: string[];
    title: string;
    campflow_link?: string | undefined;
    description?: string | undefined;
    start: string;
    end: string;
}

export async function GetAktionenEndpoint(
    request: HttpRequest,
    context: InvocationContext,
): Promise<HttpResponseInit> {
    try {
        const aktionen = await getAktionen();

        const data: AktionData[] = aktionen
            .filter((a) => !(a.stufen.length === 1 && a.stufen.every(s => s === "Leitende")))
            .map(a => {
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

export default GetAktionenEndpoint;
