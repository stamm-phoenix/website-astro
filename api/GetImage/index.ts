import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { getEnvironment } from "../lib/environment";
import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";

function getMimeType(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

export async function GetImage(
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

    const itemId = request.params.id;
    if (!itemId) {
      return {
        status: 400,
        body: "Please provide an item ID.",
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

    const item = await client
      .api(
        `/sites/${env.SHAREPOINT_SITE_ID}/lists/${env.SHAREPOINT_LEITUNGSTEAMS_LIST_ID}/items/${itemId}`,
      )
      .expand("fields")
      .get();

    let fileName = null;
    if (item.fields.Image0) {
      try {
        const parsed = JSON.parse(item.fields.Image0);
        fileName = parsed?.fileName || null;
      } catch (e) {
        fileName = null;
      }
    }

    if (!fileName) {
      return {
        status: 404,
        body: "Image not found for this item.",
      };
    }

    const url = new URL(env.SHAREPOINT_BASE_URL);
    const hostNameForToken = url.hostname;

    const token = await credential.getToken(`https://${hostNameForToken}/.default`);
    if (!token) {
      throw new Error("Failed to acquire access token from credential.getToken");
    }

    const apiUrl = `${env.SHAREPOINT_BASE_URL}/_api/v2.1/sites('${env.SHAREPOINT_SITE_ID}')/lists('${env.SHAREPOINT_LEITUNGSTEAMS_LIST_ID}')/items('${itemId}')/attachments('${encodeURIComponent(
      fileName,
    )}')/thumbnails/0/c400x400/content?prefer=noredirect,closestavailablesize`;

    context.log(`Calling SharePoint API URL: ${apiUrl}`);

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
    const contentType = getMimeType(fileName);

    return {
      status: 200,
      body: Buffer.from(arrayBuffer),
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    };
  } catch (error) {
    context.error(error);
    return {
      status: 500,
      body: "An internal server error occurred.",
    };
  }
}

export default GetImage;
