import { getEnvironment, EnvironmentVariable } from "./environment";
import { getClient } from "./token";

export interface Leitende {
  id: string;
  name: string;
  teams: string[];
  telephone?: string | undefined;
  street?: string | undefined;
  city?: string | undefined;
  imageFileName?: string | undefined;
  hasImage: boolean;
}

export async function getLeitende(): Promise<Leitende[]> {
  const client = getClient();

  const SHAREPOINT_HOST_NAME = getEnvironment(
    EnvironmentVariable.SHAREPOINT_HOST_NAME,
  );

  const SHAREPOINT_SITE_ID = getEnvironment(
    EnvironmentVariable.SHAREPOINT_SITE_ID,
  );

  const SHAREPOINT_LEITENDE_LIST_ID = getEnvironment(
    EnvironmentVariable.SHAREPOINT_LEITENDE_LIST_ID,
  );

  const response = await client
    .api(
      `/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/lists/${SHAREPOINT_LEITENDE_LIST_ID}/items`,
    )
    .expand("fields")
    .get();

  const items = Array.isArray(response?.value) ? response.value : [];
  
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
}
