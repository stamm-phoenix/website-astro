import { ausrichten, eckenAusrichten } from './belegBild';
import type { Ausrichtung, FotoFarben } from './belegBild';
import { blobToBase64 } from './belege';
import { pdfFotos } from './belegPdf';
import type { PdfSeite } from './belegPdf';
import type { Pixels, Quad } from './belegScan';

/** The photo or PDF of a receipt while it is chosen and edited in the receipt form. */

/** A chosen photo while it is being edited. */
export interface Draft {
  original: Pixels;
  originalBlob: Blob;
  originalUrl: string;
  /** The photo rotated and mirrored as chosen; the original itself while it is not. */
  bild: Pixels;
  /** The receipt's corners in `bild`; null for the whole picture. */
  quad: Quad | null;
  mode: FotoFarben;
  /** The photo as it will be submitted; for a PDF the picture of its first page. */
  result: { blob: Blob; url: string; width: number; height: number } | null;
  /** The chosen PDF, submitted as it is; its first page is `original`. Not edited. */
  pdf: Blob | null;
  /** The further pages of the PDF as pictures, shown and checked with the first. */
  pdfSeiten: PdfSeite[];
  /** The last page of a PDF too long to show it, for the check; null otherwise. */
  pdfLetzte: PdfSeite | null;
  /** How many pages the PDF has; more than shown for a very long one. */
  pdfSeitenzahl: number;
  /**
   * When a stored photo is edited again: the original kept with the receipt, sent as the
   * original instead of the stored photo the edits start from.
   */
  aufbewahrt?: Blob;
}

/** A draft of `original` without any edits; `teile` sets the rest, e.g. a PDF. */
export function entwurf(original: Pixels, originalBlob: Blob, teile: Partial<Draft> = {}): Draft {
  return {
    original,
    originalBlob,
    originalUrl: URL.createObjectURL(originalBlob),
    bild: original,
    quad: null,
    mode: 'original',
    result: null,
    pdf: null,
    pdfSeiten: [],
    pdfLetzte: null,
    pdfSeitenzahl: 0,
    ...teile,
  };
}

/** The crop tool while it is open: the uncropped picture and the corners being moved. */
export interface Zuschnitt {
  url: string;
  width: number;
  height: number;
  quad: Quad;
}

/** The photos of a receipt as the API takes them, in base64. */
export interface FotoNutzlast {
  photo: string;
  original?: string;
  pdf?: string;
  /** Further pages of a PDF, only for the check. */
  pages?: string[];
}

/** Whether anything was changed, so the photo differs from the one chosen. */
export function isEdited(draft: Draft): boolean {
  return draft.bild !== draft.original || draft.quad !== null || draft.mode !== 'original';
}

/** Whether the draft holds changes not saved yet; a stored photo opened again only once changed. */
export function ungespeichert(draft: Draft | null): boolean {
  return !!draft && (!draft.aufbewahrt || isEdited(draft));
}

/** Whether the draft has a photo to save: a stored photo opened again only once it was changed. */
export function zuSpeichern(draft: Draft | null): draft is Draft {
  return !!draft?.result && ungespeichert(draft);
}

/** The draft rotated by `schritte`, its crop turned along. */
export function gedreht(current: Draft, schritte: Ausrichtung[]): Draft {
  let { bild, quad } = current;
  for (const schritt of schritte) {
    quad = quad ? eckenAusrichten(quad, bild.width, bild.height, schritt) : null;
    bild = ausrichten(bild, schritt);
  }
  return { ...current, bild, quad };
}

/**
 * The photos for the API: the scan, plus the original if the scan differs from it; for a PDF
 * the PDF, the picture of its first page and the further pages the check reads.
 */
export async function fotoNutzlast(current: Draft): Promise<FotoNutzlast> {
  const photo = await blobToBase64(current.result!.blob);
  if (current.pdf) return pdfFotos(photo, current.pdf, current.pdfSeiten, current.pdfLetzte);
  // The original kept with a stored photo always goes along, or the server would drop it
  if (current.aufbewahrt) return { photo, original: await blobToBase64(current.aufbewahrt) };
  return isEdited(current)
    ? { photo, original: await blobToBase64(current.originalBlob) }
    : { photo };
}
