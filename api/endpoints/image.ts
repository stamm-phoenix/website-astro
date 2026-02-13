import { HttpRequest, InvocationContext, HttpResponseInit } from '@azure/functions';
import { getCredential } from '../lib/token';
import { EnvironmentVariable, getEnvironment } from '../lib/environment';
import { getLeitende } from '../lib/leitende-list';
import { getBlogEntries } from '../lib/blog-list';
import { withErrorHandling, proxyFile } from '../lib/response-utils';

function getMimeType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

async function fetchSharePointImage(
  listId: string,
  itemId: string,
  imageFileName: string,
  dimension: string,
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const SHAREPOINT_HOST_NAME = getEnvironment(EnvironmentVariable.SHAREPOINT_HOST_NAME);

  const SHAREPOINT_SITE_ID = getEnvironment(EnvironmentVariable.SHAREPOINT_SITE_ID);

  const SHAREPOINT_SITE_NAME = getEnvironment(EnvironmentVariable.SHAREPOINT_SITE_NAME);

  const credential = getCredential();

  const token = await credential.getToken(`https://${SHAREPOINT_HOST_NAME}/.default`);

  const apiUrl = `https://${SHAREPOINT_HOST_NAME}/sites/${SHAREPOINT_SITE_NAME}/_api/v2.1/sites('${SHAREPOINT_SITE_ID}')/lists('${listId}')/items('${itemId}')/attachments('${encodeURIComponent(
    imageFileName
  )}')/thumbnails/0/c${dimension}/content?prefer=noredirect,closestavailablesize`;

  return await proxyFile(apiUrl, request, context, {
    contentType: getMimeType(imageFileName),
    token: token.token,
  });
}

export async function GetLeitendeImageInternal(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const itemId = request.params.id;
  if (!itemId) {
    return {
      status: 400,
      body: 'No item ID provided',
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

  return await fetchSharePointImage(
    listId,
    item.id,
    item.imageFileName,
    '300x300',
    request,
    context
  );
}

export async function GetBlogImageInternal(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const itemId = request.params.id;
  if (!itemId) {
    return {
      status: 400,
      body: 'No item ID provided',
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

  return await fetchSharePointImage(
    listId,
    item.id,
    item.imageFileName,
    '1920x1080',
    request,
    context
  );
}

export const GetLeitendeImage = withErrorHandling(GetLeitendeImageInternal);
export const GetBlogImage = withErrorHandling(GetBlogImageInternal);
