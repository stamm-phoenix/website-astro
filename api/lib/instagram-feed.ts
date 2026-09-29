import type { InvocationContext } from '@azure/functions';
import { INSTAGRAM_GRAPH_URL, getInstagramToken, replaceInstagramToken } from './instagram-token';

export type InstagramMediaType = 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';

export interface InstagramMedia {
  id: string;
  caption?: string;
  mediaType: InstagramMediaType;
  permalink: string;
  timestamp: string;
  /**
   * Signed CDN URLs that expire; only used server-side to proxy the images. One per image of a
   * carousel, otherwise exactly one (the thumbnail for videos).
   */
  imageUrls: string[];
  /**
   * Signed CDN URL of a video (expires after about a day). Instagram omits it for videos with
   * copyrighted material such as licensed music.
   */
  videoUrl?: string;
}

interface GraphMedia {
  id?: unknown;
  caption?: unknown;
  media_type?: unknown;
  media_url?: unknown;
  thumbnail_url?: unknown;
  permalink?: unknown;
  timestamp?: unknown;
  children?: { data?: unknown };
}

const API_VERSION = 'v23.0';
const FEED_LIMIT = 12;
const CACHE_TTL_MS = 15 * 60_000;
// After a failed request the stale feed is served for this long before trying again
const RETRY_AFTER_MS = 60_000;
const TIMEOUT_MS = 10_000;
const MEDIA_TYPES: InstagramMediaType[] = ['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'];

/** Instagram rejected the access token (OAuthException, code 190). */
class InstagramAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstagramAuthError';
  }
}

let cache: { media: InstagramMedia[]; expires: number } | undefined;
let pending: Promise<InstagramMedia[]> | undefined;

/** Returns the latest posts, cached for CACHE_TTL_MS; serves the last feed if Instagram fails. */
export function getInstagramFeed(context: InvocationContext): Promise<InstagramMedia[]> {
  if (cache && cache.expires > Date.now()) {
    return Promise.resolve(cache.media);
  }
  pending ??= loadFeed(context)
    .then((media) => {
      cache = { media, expires: Date.now() + CACHE_TTL_MS };
      return media;
    })
    .catch((error: unknown) => {
      if (!cache) throw error;
      context.warn(
        `Loading the Instagram feed failed, serving the cached feed: ${error instanceof Error ? error.message : String(error)}`
      );
      cache.expires = Date.now() + RETRY_AFTER_MS;
      return cache.media;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

async function loadFeed(context: InvocationContext): Promise<InstagramMedia[]> {
  const token = await getInstagramToken(context);
  try {
    return await fetchMedia(token);
  } catch (error: unknown) {
    if (!(error instanceof InstagramAuthError)) throw error;
    const replacement = await replaceInstagramToken(token, context);
    if (!replacement) throw error;
    return await fetchMedia(replacement);
  }
}

async function fetchMedia(token: string): Promise<InstagramMedia[]> {
  const params = new URLSearchParams({
    fields:
      'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,' +
      'children{media_type,media_url,thumbnail_url}',
    limit: String(FEED_LIMIT),
    access_token: token,
  });
  // Never log this URL, it contains the token
  const response = await fetch(
    `${INSTAGRAM_GRAPH_URL}/${API_VERSION}/me/media?${params.toString()}`,
    {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );
  const body = (await response.json().catch(() => undefined)) as
    { data?: unknown; error?: { code?: unknown; message?: unknown } } | undefined;

  if (!response.ok) {
    const message = `Instagram responded with ${response.status} ${
      typeof body?.error?.message === 'string' ? body.error.message : ''
    }`.trim();
    throw body?.error?.code === 190 ? new InstagramAuthError(message) : new Error(message);
  }

  const data = Array.isArray(body?.data) ? (body.data as GraphMedia[]) : [];
  return data.flatMap((item): InstagramMedia[] => {
    const mediaType = MEDIA_TYPES.find((type) => type === item.media_type);
    const children = Array.isArray(item.children?.data) ? (item.children.data as GraphMedia[]) : [];
    const childUrls = children.map(getImageUrl).filter((url): url is string => url !== undefined);
    const ownUrl = getImageUrl(item);
    const imageUrls = childUrls.length > 0 ? childUrls : ownUrl ? [ownUrl] : [];
    if (
      !mediaType ||
      typeof item.id !== 'string' ||
      typeof item.permalink !== 'string' ||
      typeof item.timestamp !== 'string' ||
      imageUrls.length === 0
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        caption: typeof item.caption === 'string' ? item.caption : undefined,
        mediaType,
        permalink: item.permalink,
        timestamp: item.timestamp,
        imageUrls,
        videoUrl:
          mediaType === 'VIDEO' && typeof item.media_url === 'string' ? item.media_url : undefined,
      },
    ];
  });
}

/** Videos only have a thumbnail as image. */
function getImageUrl(item: GraphMedia): string | undefined {
  const url = item.media_type === 'VIDEO' ? item.thumbnail_url : item.media_url;
  return typeof url === 'string' ? url : undefined;
}
