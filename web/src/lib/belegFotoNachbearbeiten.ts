import { fetchFile } from './api';
import { photoUrl } from './belegForm';

/** A stored photo of a receipt, loaded to edit it again. */
export interface GespeichertesFoto {
  foto: Blob;
  /** The original kept next to it, if the photo was edited when it was chosen. */
  original: Blob | null;
}

/** Loads the stored photo of a receipt of the Leitendenbereich and its original, if it has one. */
export async function ladeGespeichertesFoto(beleg: {
  id: string | null;
  etag: string;
  hasOriginal: boolean;
}): Promise<GespeichertesFoto> {
  const pfad = (variante = ''): string => photoUrl(beleg, variante).replace(/^\/api/, '');
  const [foto, original] = await Promise.all([
    fetchFile(pfad()),
    beleg.hasOriginal ? fetchFile(pfad('&original=1')) : null,
  ]);
  return { foto: foto.blob, original: original?.blob ?? null };
}
