import {
  HttpRequest,
  InvocationContext,
  HttpResponseInit,
} from "@azure/functions";
import { getCredential } from "../lib/token";
import { EnvironmentVariable, getEnvironment } from "../lib/environment";
import { getLeitende } from "../lib/leitende-list";
import { getBlogEntries } from "../lib/blog-list";

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

async function fetchSharePointImage(
  listId: string,
  itemId: string,
  imageFileName: string,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const SHAREPOINT_HOST_NAME = getEnvironment(
    EnvironmentVariable.SHAREPOINT_HOST_NAME,
  );

  const SHAREPOINT_SITE_ID = getEnvironment(
    EnvironmentVariable.SHAREPOINT_SITE_ID,
  );

  const SHAREPOINT_SITE_NAME = getEnvironment(
    EnvironmentVariable.SHAREPOINT_SITE_NAME,
  );

  const credential = getCredential();

  const token = await credential.getToken(
    `https://${SHAREPOINT_HOST_NAME}/.default`,
  );

  const apiUrl = `https://${SHAREPOINT_HOST_NAME}/sites/${SHAREPOINT_SITE_NAME}/_api/v2.1/sites('${SHAREPOINT_SITE_ID}')/lists('${listId}')/items('${itemId}')/attachments('${encodeURIComponent(
    imageFileName,
  )}')/thumbnails/0/c400x400/content?prefer=noredirect,closestavailablesize`;

  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token.token}`,
    },
  });

  if (!response.ok) {
    context.error(`Failed to fetch image from SharePoint: ${response.status} ${response.statusText}`);
    return {
      status: response.status === 404 ? 404 : 502,
      body: "Failed to fetch image from upstream source",
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType = getMimeType(imageFileName);

  return {
    status: 200,
    body: Buffer.from(arrayBuffer),
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  };
}

export async function GetLeitendeImage(
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

    const item = leitende.find((l) => l.id === itemId);

    if (!item) {
      return {
        status: 404,
        body: `Leitende with ID ${itemId} not found`,
      };
    }

    if (!item.imageFileName) {
      return {
        status: 404,
        body: `No image found for leitende with ID ${itemId}`,
      };
    }

    const listId = getEnvironment(EnvironmentVariable.SHAREPOINT_LEITENDE_LIST_ID);

    return await fetchSharePointImage(listId, item.id, item.imageFileName, context);
  } catch (error: any) {
    context.error(error);
    return {
      status: 500,
      jsonBody: {
        error: error.name || "Error",
        message: error.message || "Internal Server Error",
      },
    };
  }
}

export async function GetBlogImage(
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

    const blogEntries = await getBlogEntries();

    const item = blogEntries.find((b) => b.id === itemId);

    if (!item) {
      return {
        status: 404,
        body: `Blog entry with ID ${itemId} not found`,
      };
    }

    if (!item.imageFileName) {
      return {
        status: 404,
        body: `No image found for blog entry with ID ${itemId}`,
      };
    }

    const listId = getEnvironment(EnvironmentVariable.SHAREPOINT_BLOG_LIST_ID);

    return await fetchSharePointImage(listId, item.id, item.imageFileName, context);
  } catch (error: any) {
    context.error(error);
    return {
      status: 500,
      jsonBody: {
        error: error.name || "Error",
        message: error.message || "Internal Server Error",
      },
    };
  }
}