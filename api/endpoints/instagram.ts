import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getInstagramFeed, type InstagramMediaType } from '../lib/instagram-feed';
import { proxyFile, withErrorHandling } from '../lib/response-utils';

interface InstagramPostData {
  id: string;
  caption?: string;
  mediaType: InstagramMediaType;
  permalink: string;
  timestamp: string;
  /** Number of images; more than one for carousels */
  imageCount: number;
}

export async function GetInstagramEndpoint(
  _request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const media = await getInstagramFeed(context);

  // CDN URLs stay on the server; the browser loads images via /api/instagram/{id}/image?index=n
  const data = media.map((m): InstagramPostData => ({
    id: m.id,
    caption: m.caption,
    mediaType: m.mediaType,
    permalink: m.permalink,
    timestamp: m.timestamp,
    imageCount: m.imageUrls.length,
  }));

  return {
    status: 200,
    jsonBody: data,
    headers: { 'Cache-Control': 'public, max-age=900' },
  };
}

export async function GetInstagramImageInternal(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const id = request.params.id;
  if (!id) {
    return {
      status: 400,
      body: 'No item ID provided',
    };
  }

  // Only posts of the current feed, so this cannot be used as an open proxy
  const media = (await getInstagramFeed(context)).find((m) => m.id === id);
  if (!media) {
    return {
      status: 404,
      body: `Instagram post with ID ${id} not found`,
    };
  }

  // Position within a carousel, 0 for the first (or only) image
  const index = Number(request.query.get('index') ?? '0');
  const imageUrl = Number.isInteger(index) ? media.imageUrls[index] : undefined;
  if (!imageUrl) {
    return {
      status: 404,
      body: `Image ${request.query.get('index')} of Instagram post ${id} not found`,
    };
  }

  return await proxyFile(imageUrl, context, {
    cacheControl: 'public, max-age=86400',
  });
}

export default withErrorHandling(GetInstagramEndpoint);
export const GetInstagramImage = withErrorHandling(GetInstagramImageInternal);
