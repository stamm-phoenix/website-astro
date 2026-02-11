import {cachedFetch} from "./cache";
import {getSharePointListItems} from "./sharepoint-data-access";
import {EnvironmentVariable, getEnvironment} from "./environment";

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
  return cachedFetch("leitende-list", async () => {
    const SHAREPOINT_LEITENDE_LIST_ID = getEnvironment(
      EnvironmentVariable.SHAREPOINT_LEITENDE_LIST_ID,
    );

    const items = await getSharePointListItems(SHAREPOINT_LEITENDE_LIST_ID, {
        expand: "fields"
    });
    
    const leitende: Leitende[] = items.map((item: any): Leitende => {
      let imageJson = undefined;
      if (item.fields.Image0) {
        try {
          const parsed = JSON.parse(item.fields.Image0);
          imageJson = parsed?.fileName || undefined;
        } catch (e) {
          imageJson = undefined;
        }
      }

      const rawTeams = item.fields.Team;
      const teams = Array.isArray(rawTeams)
        ? rawTeams
        : rawTeams
          ? [rawTeams]
          : [];

      const city = item.fields.City != null && item.fields.PostalCode != null
          ? `${item.fields.PostalCode} ${item.fields.City}`
          : undefined;
      
      return {
        id: item.id,
        eTag: item.eTag,
        name: item.fields.Title,
        telephone: item.fields.Telefon,
        street: item.fields.Street,
        city: city,
        teams: teams,
        hasImage: imageJson != null,
        imageFileName: imageJson,
      };
    });

    return leitende;
  }, 300);
}
