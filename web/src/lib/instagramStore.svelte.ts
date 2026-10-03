import type { InstagramPost } from './types';
import { fetchApi } from './api';
import { bakedUrl } from './bakedImages';

export const INSTAGRAM_PROFILE_URL = 'https://www.instagram.com/dpsg_stammphoenix/';

interface InstagramStoreState {
  data: InstagramPost[] | null;
  loading: boolean;
  error: boolean;
}

export const instagramStore = $state<InstagramStoreState>({
  data: null,
  loading: true,
  error: false,
});

let fetchPromise: Promise<void> | null = null;

export function fetchInstagram(): Promise<void> {
  if (fetchPromise) return fetchPromise;

  instagramStore.loading = true;
  instagramStore.error = false;

  fetchPromise = (async () => {
    try {
      instagramStore.data = await fetchApi<InstagramPost[]>('/instagram');
    } catch {
      instagramStore.error = true;
    } finally {
      fetchPromise = null;
      instagramStore.loading = false;
    }
  })();

  return fetchPromise;
}

/** Images are proxied by the API, so the browser never contacts Instagram. */
/** `large` is for the post dialog, the tiles use the smaller default. */
export function getInstagramImageUrl(
  id: string,
  index = 0,
  size: 'small' | 'large' = 'small'
): string {
  return bakedUrl(
    `/api/instagram/${id}/image?index=${index}${size === 'large' ? '&size=large' : ''}`
  );
}

/** Redirects to Instagram; only requested once someone clicks play. */
export function getInstagramVideoUrl(id: string): string {
  return `/api/instagram/${id}/video`;
}

/** What the visitor is asked to confirm: leaving for Instagram, or loading a video from there */
export type InstagramConsentKind = 'link' | 'video';

/** A post to open on Instagram */
export interface InstagramLinkConsent {
  kind: 'link';
  href: string;
}

/** A video to load from Instagram; `onconfirm` starts it */
export interface InstagramVideoConsent {
  kind: 'video';
  onconfirm: () => void;
}

export type InstagramConsentRequest = InstagramLinkConsent | InstagramVideoConsent;

const CONFIRMED_KEYS: Record<InstagramConsentKind, string> = {
  link: 'instagram-leave-confirmed',
  video: 'instagram-video-confirmed',
};

/** Whether to ask first (not if the visitor declined further questions for this visit). */
export function shouldConfirmInstagram(kind: InstagramConsentKind): boolean {
  try {
    return sessionStorage.getItem(CONFIRMED_KEYS[kind]) !== 'true';
  } catch {
    return true;
  }
}

export function rememberInstagramConfirmation(kind: InstagramConsentKind): void {
  try {
    sessionStorage.setItem(CONFIRMED_KEYS[kind], 'true');
  } catch {
    // Storage unavailable (e.g. private mode); then we simply ask again next time
  }
}
