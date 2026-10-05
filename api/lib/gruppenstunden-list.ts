import { getSharePointListItems } from './sharepoint-data-access';
import { CONFIG } from './config';

export interface Gruppenstunde {
  id: string;
  stufe: string;
  weekday: string;
  time: string;
  location: string;
  ageRange: string;
  description: string;
}

export async function getGruppenstunden(): Promise<Gruppenstunde[]> {
  const SHAREPOINT_GRUPPENSTUNDEN_LIST_ID = CONFIG.sharepoint.lists.gruppenstunden;

  const items = await getSharePointListItems(SHAREPOINT_GRUPPENSTUNDEN_LIST_ID, {
    expand: 'fields',
  });

  const gruppenstunden: Gruppenstunde[] = items.map((item: unknown): Gruppenstunde => {
    const listItem = item as {
      id: string;
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
      stufe: listItem.fields.Title,
      description: listItem.fields.Beschreibung,
      weekday: listItem.fields.Wochentag,
      time: listItem.fields.Zeit,
      ageRange: listItem.fields.Alter,
      location: listItem.fields.Ort,
    };
  });

  return gruppenstunden;
}
