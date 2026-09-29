import type { InstagramPost } from './types';
import { fetchApi } from './api';

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
export function getInstagramImageUrl(id: string, index = 0): string {
  return `/api/instagram/${id}/image?index=${index}`;
}

/** Redirects to Instagram; only requested once someone clicks play. */
export function getInstagramVideoUrl(id: string): string {
  return `/api/instagram/${id}/video`;
}

/** What the visitor is asked to confirm: leaving for Instagram, or loading a video from there */
export type InstagramConsentKind = 'link' | 'video';

/** A post to open on Instagram, or a video to load from there */
export type InstagramConsentRequest =
  { kind: 'link'; href: string } | { kind: 'video'; onconfirm: () => void };

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
