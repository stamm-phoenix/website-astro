import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";
import { getEnvironment } from "../lib/environment";

interface Teammember {
  name: string;
  teams: string[];
  image: string;
}

export async function GetTeams(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const env = getEnvironment(context);

    if (!env) {
      return {
        status: 500,
        body: "Missing environment variables",
      };
    }

    const credential = new ClientSecretCredential(
      env.AZURE_TENANT_ID,
      env.AZURE_CLIENT_ID,
      env.AZURE_CLIENT_SECRET,
    );

    const client = Client.initWithMiddleware({
      authProvider: {
        getAccessToken: async () => {
          const token = await credential.getToken(
            "https://graph.microsoft.com/.default",
          );
          if (!token) {
            throw new Error(
              "Failed to acquire access token from credential.getToken",
            );
          }
          return token.token;
        },
      },
    });

    const response = await client
      .api(
        `/sites/${env.SHAREPOINT_SITE_ID}/lists/${env.SHAREPOINT_LEITUNGSTEAMS_LIST_ID}/items`,
      )
      .expand("fields")
      .get();

    const teammembers: Teammember[] = response.value.map((item: any) => {
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
        name: item.fields.Title,
        teams,
        image: imageJson,
      };
    });

    return {
      status: 200,
      jsonBody: teammembers,
    };
  } catch (error) {
    context.error(error);
    return { status: 500, body: "Error fetching list items" };
  }
}
