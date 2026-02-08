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
  dimension: string,
  context: InvocationContext,
  requestHeaders: Headers,
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
  )}')/thumbnails/0/c${dimension}/content?prefer=noredirect,closestavailablesize`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.token}`,
  };

  const ifNoneMatch = requestHeaders.get("if-none-match");
  if (ifNoneMatch) {
    headers["If-None-Match"] = ifNoneMatch;
  }

  const response = await fetch(apiUrl, {
    method: "GET",
    headers: headers,
  });

  const CACHE_CONTROL = "public, max-age=86400, s-maxage=86400";

  if (response.status === 304) {
    return {
      status: 304,
      headers: {
        "ETag": response.headers.get("ETag") || "",
        "Cache-Control": CACHE_CONTROL,
      },
    };
  }

  if (!response.ok) {
    context.error(`Failed to fetch image from SharePoint: ${response.status} ${response.statusText}`);
    return {
      status: response.status === 404 ? 404 : 502,
      body: "Failed to fetch image from upstream source",
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType = getMimeType(imageFileName);
  const etag = response.headers.get("ETag");

  const responseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": CACHE_CONTROL,
  };

  if (etag) {
    responseHeaders["ETag"] = etag;
  }

  return {
    status: 200,
    body: Buffer.from(arrayBuffer),
    headers: responseHeaders,
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

    return await fetchSharePointImage(listId, item.id, item.imageFileName, "300x300", context, request.headers);
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

    return await fetchSharePointImage(listId, item.id, item.imageFileName, "1920x1080", context, request.headers);
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
