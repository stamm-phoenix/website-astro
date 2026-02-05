import {
  HttpRequest,
  InvocationContext,
  HttpResponseInit,
} from "@azure/functions";
import { getClient } from "../lib/token";
import { EnvironmentVariable, getEnvironment } from "../lib/environment";

interface TeamMember {
  id: string;
  name: string;
  teams: string[];
}

export async function GetTeams(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
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
      const rawTeams = item.fields.Team;
      const teams = Array.isArray(rawTeams)
        ? rawTeams
        : rawTeams
          ? [rawTeams]
          : [];

      return {
        id: item.id,
        name: item.fields.Title,
        teams,
      };
    });

    return {
      status: 200,
      jsonBody: teammembers,
    };
  } catch (error) {
    context.error(error);
    return { status: 500, body: "Internal Server Error" };
  }
}

export default GetTeams;
