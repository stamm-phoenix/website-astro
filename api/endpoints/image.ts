import {
  HttpRequest,
  InvocationContext,
  HttpResponseInit,
} from "@azure/functions";
import { getCredential } from "../lib/token";
import { EnvironmentVariable, getEnvironment } from "../lib/environment";
import {getLeitende} from "../lib/leitende-list";

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
    const itemId = request.params.id;
    if (!itemId) {
      return {
        status: 400,
        body: "No item ID provided",
      };
    }
    
    const leitende = await getLeitende();
    
    const item = leitende.find(l => l.id === itemId);

    if (!item) {
      return {
        status: 404,
        body: `Team member with ID ${itemId} not found`,
      };
    }

    if (!item.imageFileName) {
      return {
        status: 404,
        body: `No image found for team member with ID ${itemId}`,
      };
    }

    const SHAREPOINT_HOST_NAME = getEnvironment(
      EnvironmentVariable.SHAREPOINT_HOST_NAME,
    );

    const SHAREPOINT_SITE_ID = getEnvironment(
      EnvironmentVariable.SHAREPOINT_SITE_ID,
    );

    const SHAREPOINT_SITE_NAME = getEnvironment(
      EnvironmentVariable.SHAREPOINT_SITE_NAME,
    );

    const SHAREPOINT_LEITENDE_LIST_ID = getEnvironment(
      EnvironmentVariable.SHAREPOINT_LEITENDE_LIST_ID,
    );

    const credential = getCredential();

    const token = await credential.getToken(
      `https://${SHAREPOINT_HOST_NAME}/.default`,
    );

    const apiUrl = `https://${SHAREPOINT_HOST_NAME}/sites/${SHAREPOINT_SITE_NAME}/_api/v2.1/sites('${SHAREPOINT_SITE_ID}')/lists('${SHAREPOINT_LEITENDE_LIST_ID}')/items('${item.id}')/attachments('${encodeURIComponent(
      item.imageFileName,
    )}')/thumbnails/0/c400x400/content?prefer=noredirect,closestavailablesize`;

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token.token}`,
      },
    });

    const arrayBuffer = await response.arrayBuffer();
    const contentType = getMimeType(item.imageFileName);

    return {
      status: 200,
      body: Buffer.from(arrayBuffer),
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    };
  } catch (error: any) {
    context.error(error);
    return {
      status: 500,
      jsonBody: {
        error: error.name || "Error",
        message: error.message || "Internal Server Error",
        stack: error.stack,
      },
    };
  }
}
