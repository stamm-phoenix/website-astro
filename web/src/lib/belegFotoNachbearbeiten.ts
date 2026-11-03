import { fetchFile } from './api';
import { loadPhoto } from './belege';
import { entwurf } from './belegEntwurf';
import type { Draft } from './belegEntwurf';
import { photoUrl } from './belegForm';
import { readPixels } from './belegScan';

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

/**
 * A draft of the stored photo, to edit it again: the edits start from the stored photo, and the
 * original kept with the receipt (or else the stored photo) is sent as its original.
 */
export async function entwurfAusGespeichertem(
  laden: () => Promise<GespeichertesFoto>
): Promise<Draft> {
  const gespeichert = await laden();
  const canvas = await loadPhoto(gespeichert.foto);
  const original = readPixels(canvas, canvas.width, canvas.height);
  return entwurf(original, gespeichert.foto, {
    aufbewahrt: gespeichert.original ?? gespeichert.foto,
  });
}
