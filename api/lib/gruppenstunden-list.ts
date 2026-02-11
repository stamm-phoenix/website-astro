import {getClient} from "./token";
import {EnvironmentVariable, getEnvironment} from "./environment";
import {cachedFetch} from "./cache";

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
        const client = getClient();

        const SHAREPOINT_HOST_NAME = getEnvironment(
            EnvironmentVariable.SHAREPOINT_HOST_NAME,
        );

        const SHAREPOINT_SITE_ID = getEnvironment(
            EnvironmentVariable.SHAREPOINT_SITE_ID,
        );

        const SHAREPOINT_GRUPPENSTUNDEN_LIST_ID = getEnvironment(
            EnvironmentVariable.SHAREPOINT_GRUPPENSTUNDEN_LIST_ID,
        );

        const response = await client
            .api(
                `/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/lists/${SHAREPOINT_GRUPPENSTUNDEN_LIST_ID}/items`,
            )
            .expand("fields")
            .get();

        const items = Array.isArray(response?.value) ? response.value : [];

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
    });
}