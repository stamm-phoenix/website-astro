import type { DownloadFile } from "./types";
import { fetchApi } from "./api";

interface DownloadsStoreState {
  data: DownloadFile[] | null;
  loading: boolean;
  error: boolean;
}

export const downloadsStore = $state<DownloadsStoreState>({
  data: null,
  loading: true,
  error: false,
});

let fetchPromise: Promise<void> | null = null;

export function fetchDownloads(): Promise<void> {
  if (fetchPromise) return fetchPromise;
  if (downloadsStore.data !== null) return Promise.resolve();

  downloadsStore.loading = true;
  downloadsStore.error = false;

  fetchPromise = (async () => {
    try {
      const data = await fetchApi<DownloadFile[]>("/downloads");
      downloadsStore.data = data.sort(
        (a, b) =>
          new Date(b.lastModifiedAt).getTime() -
          new Date(a.lastModifiedAt).getTime(),
      );
      downloadsStore.loading = false;
    } catch {
      fetchPromise = null;
      downloadsStore.error = true;
      downloadsStore.loading = false;
    }
  })();

  return fetchPromise;
}

export function getDownloadPreviewUrl(id: string, size: "small" | "medium" | "large" = "medium"): string {
  return `/api/downloads/${id}/image/${size}`;
}

export function getDownloadFileUrl(id: string): string {
  return `/api/downloads/${id}/file`;
}

export function formatFileSize(bytes: number): string {
  bytes = Math.max(0, Number(bytes) || 0);
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  let i = Math.floor(Math.log(bytes) / Math.log(k));
  i = Math.min(Math.max(i, 0), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
