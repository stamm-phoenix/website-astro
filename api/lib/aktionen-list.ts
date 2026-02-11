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

export function isLeitendeOnly(aktion: Aktion): boolean {
    return aktion.stufen.length === 1 && aktion.stufen.every(s => s === "Leitende");
}

export async function getAktionen(): Promise<Aktion[]> {
    return cachedFetch("aktionen-list", async () => {
        const SHAREPOINT_CALENDAR_LIST_ID = getEnvironment(
            EnvironmentVariable.SHAREPOINT_CALENDAR_LIST_ID,
        );

        const items = await getSharePointListItems(SHAREPOINT_CALENDAR_LIST_ID, {
            expand: "fields"
        });

        const aktionen: Aktion[] = items.map((item: unknown): Aktion => {
            const listItem = item as {
                id: string;
                eTag: string;
                fields: {
                    Stufen: string | string[];
                    Title: string;
                    CampFlow_x002d_Anmeldung?: { Url: string };
                    Beschreibung?: string;
                    Start?: string;
                    End?: string;
                }
            };
            const rawStufen = listItem.fields.Stufen;
            const stufen = Array.isArray(rawStufen)
                ? rawStufen
                : rawStufen
                    ? [rawStufen]
                    : [];
            
            return {
                id: listItem.id,
                eTag: listItem.eTag,
                stufen: stufen,
                title: listItem.fields.Title,
                campflow_link: listItem.fields.CampFlow_x002d_Anmeldung?.Url,
                description: listItem.fields.Beschreibung,
                start: listItem.fields.Start?.split("T")[0] || "",
                end: listItem.fields.End?.split("T")[0] || "",
            };
        });

        return aktionen;
    }, 300);
}