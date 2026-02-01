import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";
import "isomorphic-fetch";

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
    const envVars = {
      AZURE_TENANT_ID: process.env.AZURE_TENANT_ID,
      AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID,
      AZURE_CLIENT_SECRET: process.env.AZURE_CLIENT_SECRET,
      SHAREPOINT_SITE_ID: process.env.SHAREPOINT_SITE_ID,
      SHAREPOINT_LEITUNGSTEAMS_LIST_ID:
        process.env.SHAREPOINT_LEITUNGSTEAMS_LIST_ID,
    };

    const missingVars = Object.entries(envVars)
      .filter(([_, value]) => !value)
      .map(([key]) => key);

    if (missingVars.length > 0) {
      const errorMsg = `Missing environment variables: ${missingVars.join(", ")}`;
      context.error(errorMsg);
      return { status: 500, body: errorMsg };
    }

    const {
      AZURE_TENANT_ID: tenantId,
      AZURE_CLIENT_ID: clientId,
      AZURE_CLIENT_SECRET: clientSecret,
      SHAREPOINT_SITE_ID: siteId,
      SHAREPOINT_LEITUNGSTEAMS_LIST_ID: listId,
    } = envVars as Record<string, string>;

    const credential = new ClientSecretCredential(
      tenantId,
      clientId,
      clientSecret,
    );

    const client = Client.initWithMiddleware({
      authProvider: {
        getAccessToken: async () => {
          const token = await credential.getToken(
            "https://graph.microsoft.com/.default",
          );
          if (!token) {
            throw new Error("Failed to acquire access token from credential.getToken");
          }
          return token.token;
        },
      },
    });

    const response = await client
      .api(`/sites/${siteId}/lists/${listId}/items`)
      .expand("fields")
      .get();

    const teammembers: Teammember[] = response.value.map((item: any) => {
      const imageJson = JSON.parse(item.fields.Image0).fileName;

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
