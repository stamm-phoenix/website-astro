import { cachedFetch } from './cache';
import { getSharePointListItems } from './sharepoint-data-access';
import { EnvironmentVariable, getEnvironment } from './environment';

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
  return cachedFetch(
    'gruppenstunden-list',
    async () => {
      const SHAREPOINT_GRUPPENSTUNDEN_LIST_ID = getEnvironment(
        EnvironmentVariable.SHAREPOINT_GRUPPENSTUNDEN_LIST_ID
      );

      const items = await getSharePointListItems(SHAREPOINT_GRUPPENSTUNDEN_LIST_ID, {
        expand: 'fields',
      });

      const gruppenstunden: Gruppenstunde[] = items.map((item: unknown): Gruppenstunde => {
        const listItem = item as {
          id: string;
          eTag: string;
          fields: {
            Title: string;
            Beschreibung: string;
            Wochentag: string;
            Zeit: string;
            Alter: string;
            Ort: string;
          };
        };
        return {
          id: listItem.id,
          eTag: listItem.eTag,
          stufe: listItem.fields.Title,
          description: listItem.fields.Beschreibung,
          weekday: listItem.fields.Wochentag,
          time: listItem.fields.Zeit,
          ageRange: listItem.fields.Alter,
          location: listItem.fields.Ort,
        };
      });

      return gruppenstunden;
    },
    300
  );
}
