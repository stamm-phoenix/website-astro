import {cachedFetch} from "./cache";
import {getSharePointListItems} from "./sharepoint-data-access";
import {EnvironmentVariable, getEnvironment} from "./environment";

export interface Aktion {
    id: string;
    eTag: string;
    stufen: string[];
    title: string;
    campflow_link?: string | undefined;
    description?: string | undefined;
    start: string;
    end: string;
}

export async function getAktionen(): Promise<Aktion[]> {
    return cachedFetch("aktionen-list", async () => {
        const SHAREPOINT_CALENDAR_LIST_ID = getEnvironment(
            EnvironmentVariable.SHAREPOINT_CALENDAR_LIST_ID,
        );

        const items = await getSharePointListItems(SHAREPOINT_CALENDAR_LIST_ID, {
            expand: "fields"
        });

        const aktionen: Aktion[] = items.map((item: any): Aktion => {
            const rawStufen = item.fields.Stufen;
            const stufen = Array.isArray(rawStufen)
                ? rawStufen
                : rawStufen
                    ? [rawStufen]
                    : [];
            
            return {
                id: item.id,
                eTag: item.eTag,
                stufen: stufen,
                title: item.fields.Title,
                campflow_link: item.fields.CampFlow_x002d_Anmeldung?.Url,
                description: item.fields.Beschreibung,
                start: item.fields.Start?.split("T")[0],
                end: item.fields.End?.split("T")[0],
            };
        });

        return aktionen;
    }, 300);
}