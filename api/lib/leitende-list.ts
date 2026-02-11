import { cachedFetch } from './cache';
import { getSharePointListItems } from './sharepoint-data-access';
import { EnvironmentVariable, getEnvironment } from './environment';

export interface Leitende {
  id: string;
  eTag: string;
  name: string;
  teams: string[];
  telephone?: string | undefined;
  street?: string | undefined;
  city?: string | undefined;
  imageFileName?: string | undefined;
  hasImage: boolean;
}

export async function getLeitende(): Promise<Leitende[]> {
  return cachedFetch(
    'leitende-list',
    async () => {
      const SHAREPOINT_LEITENDE_LIST_ID = getEnvironment(
        EnvironmentVariable.SHAREPOINT_LEITENDE_LIST_ID
      );

      const items = await getSharePointListItems(SHAREPOINT_LEITENDE_LIST_ID, {
        expand: 'fields',
      });

      const leitende: Leitende[] = items.map((item: unknown): Leitende => {
        const listItem = item as {
          id: string;
          eTag: string;
          fields: {
            Image0?: string;
            Title: string;
            Telefon?: string;
            Street?: string;
            City?: string;
            PostalCode?: string;
            Team: string | string[];
          };
        };
        let imageJson = undefined;
        if (listItem.fields.Image0) {
          try {
            const parsed = JSON.parse(listItem.fields.Image0);
            imageJson = parsed?.fileName || undefined;
          } catch (e) {
            imageJson = undefined;
          }
        }

        const rawTeams = listItem.fields.Team;
        const teams = Array.isArray(rawTeams) ? rawTeams : rawTeams ? [rawTeams] : [];

        const city =
          listItem.fields.City != null && listItem.fields.PostalCode != null
            ? `${listItem.fields.PostalCode} ${listItem.fields.City}`
            : undefined;

        return {
          id: listItem.id,
          eTag: listItem.eTag,
          name: listItem.fields.Title,
          telephone: listItem.fields.Telefon,
          street: listItem.fields.Street,
          city: city,
          teams: teams,
          hasImage: imageJson != null,
          imageFileName: imageJson,
        };
      });
      return leitende;
    },
    300
  );
}
