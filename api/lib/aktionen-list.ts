import {getClient} from "./token";
import {EnvironmentVariable, getEnvironment} from "./environment";

export interface Aktion {
    id: string;
    stufen: string[];
    title: string;
    campflow_link?: string | undefined;
    description?: string | undefined;
    start: string;
    end: string;
}

export async function getAktionen(): Promise<Aktion[]> {
    const client = getClient();

    const SHAREPOINT_HOST_NAME = getEnvironment(
        EnvironmentVariable.SHAREPOINT_HOST_NAME,
    );

    const SHAREPOINT_SITE_ID = getEnvironment(
        EnvironmentVariable.SHAREPOINT_SITE_ID,
    );

    const SHAREPOINT_CALENDAR_LIST_ID = getEnvironment(
        EnvironmentVariable.SHAREPOINT_CALENDAR_LIST_ID,
    );

    const response = await client
        .api(
            `/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/lists/${SHAREPOINT_CALENDAR_LIST_ID}/items`,
        )
        .expand("fields")
        .get();

    const items = Array.isArray(response?.value) ? response.value : [];

    const aktionen: Aktion[] = items.map((item: any): Aktion => {
        const rawStufen = item.fields.Stufen;
        const stufen = Array.isArray(rawStufen)
            ? rawStufen
            : rawStufen
                ? [rawStufen]
                : [];
        
        return {
            id: item.id,
            stufen: stufen,
            title: item.fields.Title,
            campflow_link: item.fields.CampFlow_x002d_Anmeldung?.Url,
            description: item.fields.Beschreibung,
            start: item.fields.Start,
            end: item.fields.End,
        };
    });

    return aktionen;
}