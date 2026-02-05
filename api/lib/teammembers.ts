import { getEnvironment, EnvironmentVariable } from "./environment";
import { getClient } from "./token";

export interface TeamMember {
  id: string;
  name: string;
  teams: string[];
  imageFileName?: string | undefined;
  hasImage: boolean;
}

export async function getTeamMembers(
  withImages: boolean = false,
): Promise<TeamMember[]> {
  const client = getClient();

  const SHAREPOINT_HOST_NAME = getEnvironment(
    EnvironmentVariable.SHAREPOINT_HOST_NAME,
  );

  const SHAREPOINT_SITE_ID = getEnvironment(
    EnvironmentVariable.SHAREPOINT_SITE_ID,
  );

  const SHAREPOINT_TEAMS_LIST_ID = getEnvironment(
    EnvironmentVariable.SHAREPOINT_TEAMS_LIST_ID,
  );

  const response = await client
    .api(
      `/sites/${SHAREPOINT_HOST_NAME},${SHAREPOINT_SITE_ID}/lists/${SHAREPOINT_TEAMS_LIST_ID}/items`,
    )
    .expand("fields")
    .get();

  const teammembers: TeamMember[] = response.value.map((item: any) => {
    let imageJson = null;
    if (item.fields.Image0) {
      try {
        const parsed = JSON.parse(item.fields.Image0);
        imageJson = parsed?.fileName || null;
      } catch (e) {
        imageJson = null;
      }
    }

    const rawTeams = item.fields.Team;
    const teams = Array.isArray(rawTeams)
      ? rawTeams
      : rawTeams
        ? [rawTeams]
        : [];

    return {
      id: item.id,
      name: item.fields.Title,
      teams: teams,
      hasImage: imageJson != null,
      imageFileName: withImages ? imageJson : undefined,
    };
  });

  return teammembers;
}
