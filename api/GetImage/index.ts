import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { getEnvironment } from "../lib/environment";
import { ClientSecretCredential } from "@azure/identity";

export async function GetImage(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const env = getEnvironment(context);

  if (!env) {
    return {
      status: 500,
      body: "Missing environment variables",
    };
  }

  const itemId = request.params.id;
  const fileName = request.params.fileName;

  const credential = new ClientSecretCredential(
    env.AZURE_TENANT_ID,
    env.AZURE_CLIENT_ID,
    env.AZURE_CLIENT_SECRET,
  );

  const token = await credential.getToken(
    "https://graph.microsoft.com/.default",
  );
  if (!token) {
    throw new Error("Failed to acquire access token from credential.getToken");
  }

  const hostName = env.SHAREPOINT_SITE_ID.split(",")[0];
  const siteId = env.SHAREPOINT_SITE_ID.split(",")[1];
  const listId = env.SHAREPOINT_LEITUNGSTEAMS_LIST_ID;

  const apiUrl = `https://${hostName}/sites/${siteId}/_api/v2.1/sites('${siteId}')/lists('${listId}')/items('${itemId}')/attachments('${encodeURIComponent(fileName)}')/$value`;

  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token.token}`,
      Accept: "application/json;odata=verbose",
    },
  });

  if (!response.ok) {
    throw new Error(
      `SharePoint API Error: ${response.status} ${response.statusText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();

  return {
    status: 200,
    body: Buffer.from(arrayBuffer),
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  };
}

export default GetImage;
