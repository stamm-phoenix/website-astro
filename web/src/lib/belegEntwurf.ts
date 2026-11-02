import type { FotoFarben } from './belegBild';
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
