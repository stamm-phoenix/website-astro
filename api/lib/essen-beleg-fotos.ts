import { deleteBlob, listBlobs } from './blob-storage';
import {
  ORPHAN_MIN_AGE_MS,
  belegPhotoFiles,
  deleteBelegFotoIn,
  readBelegFotoIn,
  storeBelegFotoIn,
} from './beleg-photos';

/**
 * The photos of the receipts of a Planung of the Essensplanung (`docs/essensplanung.md`, Belege)
 * in Blob Storage, one folder per Planung: `essen-belege/<planungId>/<datei>`. The files are
 * named and made like those of the Belege of the Leitendenbereich (`beleg-photos.ts`); only the
 * file name is stored with the receipt (`essen.beleg.foto`). Never public: the API serves them
 * after checking the link's token.
 */

export function essenBelegOrdner(planungId: number): string {
  return `essen-belege/${planungId}/`;
}

export function speichereBelegFoto(
  planungId: number,
  fotos: { photo: Uint8Array; original?: Uint8Array; pdf?: Uint8Array }
): Promise<string> {
  return storeBelegFotoIn(essenBelegOrdner(planungId), fotos.photo, fotos.original, fotos.pdf);
}

export function leseBelegFoto(
  planungId: number,
  foto: string,
  variante: 'photo' | 'original' | 'thumb' | 'file'
): Promise<Buffer | undefined> {
  return readBelegFotoIn(essenBelegOrdner(planungId), foto, variante);
}

export function loescheBelegFoto(planungId: number, foto: string): Promise<void> {
  return deleteBelegFotoIn(essenBelegOrdner(planungId), foto);
}

/** Deletes every file of the Planung's folder, e.g. before the Planung itself goes. */
export async function loescheBelegFotosDerPlanung(planungId: number): Promise<number> {
  const dateien = await listBlobs(essenBelegOrdner(planungId));
  for (const datei of dateien) await deleteBlob(datei.name);
  return dateien.length;
}

/**
 * Deletes files of the Planung's folder no receipt refers to any more, e.g. after a deletion
 * whose cleanup failed. Only files older than `ORPHAN_MIN_AGE_MS`: uploads store a file before
 * they save its name.
 */
export async function loescheVerwaisteBelegFotos(
  planungId: number,
  fotos: (string | null)[],
  now: number = Date.now()
): Promise<number> {
  const ordner = essenBelegOrdner(planungId);
  const bekannt = new Set(fotos.flatMap((foto) => (foto ? belegPhotoFiles(foto) : [])));
  let geloescht = 0;
  for (const datei of await listBlobs(ordner)) {
    if (bekannt.has(datei.name.slice(ordner.length))) continue;
    if (now - datei.lastModified.getTime() < ORPHAN_MIN_AGE_MS) continue;
    await deleteBlob(datei.name);
    geloescht++;
  }
  return geloescht;
}
