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
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    const siteId = process.env.SHAREPOINT_SITE_ID;
    const listId = process.env.SHAREPOINT_LEITUNGSTEAMS_LIST_ID;

    if (!tenantId || !clientId || !clientSecret || !siteId || !listId) {
      return { status: 500, body: "Missing environment variables" };
    }

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

      return {
        name: item.fields.Title,
        teams: item.fields.Team,
        string: imageJson,
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
