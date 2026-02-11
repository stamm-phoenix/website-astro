import {cachedFetch} from "./cache";
import {getSharePointListItems} from "./sharepoint-data-access";
import {EnvironmentVariable, getEnvironment} from "./environment";

export interface Gruppenstunde {
    id: string;
    eTag: string;
    stufe: string;
    weekday: string;
    time: string;
    location: string;
    ageRange: string;
    description: string;
}

export async function getGruppenstunden(): Promise<Gruppenstunde[]> {
    return cachedFetch("gruppenstunden-list", async () => {
        const SHAREPOINT_GRUPPENSTUNDEN_LIST_ID = getEnvironment(
            EnvironmentVariable.SHAREPOINT_GRUPPENSTUNDEN_LIST_ID,
        );

        const items = await getSharePointListItems(SHAREPOINT_GRUPPENSTUNDEN_LIST_ID, {
            expand: "fields"
        });

        const gruppenstunden: Gruppenstunde[] = items.map((item: any): Gruppenstunde => {
            return {
                id: item.id,
                eTag: item.eTag,
                stufe: item.fields.Title,
                description: item.fields.Beschreibung,
                weekday: item.fields.Wochentag,
                time: item.fields.Zeit,
                ageRange: item.fields.Alter,
                location: item.fields.Ort
            };
        });

        return gruppenstunden;
    }, 300);
}