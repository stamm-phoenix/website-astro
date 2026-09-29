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

const LEAVE_CONFIRMED_KEY = 'instagram-leave-confirmed';

/** Whether to ask before opening a post on Instagram (not if declined for this visit). */
export function shouldConfirmInstagramLink(): boolean {
  try {
    return sessionStorage.getItem(LEAVE_CONFIRMED_KEY) !== 'true';
  } catch {
    return true;
  }
}

export function rememberInstagramConfirmation(): void {
  try {
    sessionStorage.setItem(LEAVE_CONFIRMED_KEY, 'true');
  } catch {
    // Storage unavailable (e.g. private mode); then we simply ask again next time
  }
}
