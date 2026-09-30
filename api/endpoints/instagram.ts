import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getInstagramFeed, type InstagramMediaType } from '../lib/instagram-feed';
import { getScaledImage } from '../lib/instagram-images';
import { withErrorHandling } from '../lib/response-utils';

interface InstagramPostData {
  id: string;
  caption?: string;
  mediaType: InstagramMediaType;
  permalink: string;
  timestamp: string;
  /** Number of images; more than one for carousels */
  imageCount: number;
  /** Whether the video can be played on the site (see /api/instagram/{id}/video) */
  hasVideo: boolean;
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
    hasVideo: m.videoUrl !== undefined,
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

  // The post dialog asks for a larger version than the tiles
  const size = request.query.get('size') === 'large' ? 'large' : 'small';
  const image = await getScaledImage(`${id}/${index}`, imageUrl, size);
  if (!image) {
    context.error(`Failed to fetch image ${index} of Instagram post ${id}`);
    return {
      status: 502,
      body: 'Failed to fetch image from Instagram',
    };
  }

  return {
    status: 200,
    body: image.body,
    headers: {
      'Content-Type': image.contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  };
}

/**
 * Redirects to the current CDN URL of a video. Only called when someone clicks play, so the
 * browser contacts Instagram only then; the URL expires, so it is looked up on every request.
 */
export async function GetInstagramVideoInternal(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const id = request.params.id;
  const media = (await getInstagramFeed(context)).find((m) => m.id === id);
  if (!media?.videoUrl) {
    return {
      status: 404,
      body: `No video found for Instagram post ${id}`,
    };
  }

  return {
    status: 302,
    headers: {
      Location: media.videoUrl,
      'Cache-Control': 'no-store',
      // The CDN does not need to know on which page the video is shown
      'Referrer-Policy': 'no-referrer',
    },
  };
}

export default withErrorHandling(GetInstagramEndpoint);
export const GetInstagramImage = withErrorHandling(GetInstagramImageInternal);
export const GetInstagramVideo = withErrorHandling(GetInstagramVideoInternal);
