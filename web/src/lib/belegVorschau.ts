import { fetchFile } from './api';

/** How long the dialog waits for the photo; then it opens and the photo loads inside. */
export const VORSCHAU_WARTEN_MS = 8000;

/**
 * Loads and decodes the photo of a receipt before its dialog opens, so the dialog does not grow
 * once the picture arrives. Answers an object URL to show it with, or null when it did not load
 * in time or the opening was cancelled; the dialog then loads the photo itself.
 */
export async function ladeVorschau(path: string, signal: AbortSignal): Promise<string | null> {
  const timeout = AbortSignal.timeout(VORSCHAU_WARTEN_MS);
  const both = AbortSignal.any([signal, timeout]);
  let url: string | null = null;
  try {
    const file = await fetchFile(path.replace(/^\/api/, ''), both);
    url = URL.createObjectURL(file.blob);
    const image = new Image();
    image.src = url;
    await image.decode();
    if (both.aborted) throw new Error('abgebrochen');
    return url;
  } catch {
    if (url) URL.revokeObjectURL(url);
    return null;
  }
}
