import type { GerichtEinheit } from '../../../../api/lib/essen-gerichte-model';
import { guardUnsavedChanges } from '../../lib/unsavedChanges';

/** Shopping trips shown in the live mode now, by id, counted (`EinkaufLive.svelte`). */
export const lebendig = new Map<number, number>();

/** Notes the live mode of a trip on screen; the returned function notes that it went. */
export function liveOffen(einkaufId: number): () => void {
  lebendig.set(einkaufId, (lebendig.get(einkaufId) ?? 0) + 1);
  return () => {
    const rest = (lebendig.get(einkaufId) ?? 1) - 1;
    if (rest > 0) lebendig.set(einkaufId, rest);
    else lebendig.delete(einkaufId);
  };
}

/** Rows of the live mode on screen (`<einkaufId>:<planungZutatId>`), counted. */
export const sichtbar = new Map<string, number>();

/** Unsaved input of a row of the live mode, kept while the trip shows its list or form. */
export interface LiveEntwurf {
  menge: string;
  einheit: GerichtEinheit;
  ersatz: string;
  etag: string | null;
  konflikt: string | null;
}

/** Unsaved input by `<einkaufId>:<planungZutatId>`, also of rows not on screen now. */
export const entwuerfe = new Map<string, LiveEntwurf>();

/** The row whose amount is open, by trip, so it opens again when coming back. */
export const offeneZeile = new Map<number, string>();

let schutz: (() => void) | null = null;

/**
 * Drops all kept input once the page of the Planung is really left (the navigation went ahead,
 * after „Änderungen verwerfen“); a navigation that was cancelled keeps it.
 */
function seiteVerlassen(): void {
  entwuerfe.clear();
  offeneZeile.clear();
  aufraeumen();
}

function aufraeumen(): void {
  if (!schutz) return;
  schutz();
  schutz = null;
  document.removeEventListener('astro:before-swap', seiteVerlassen);
}

/** Keeps unsaved input; leaving the page asks first while there is any. */
export function merkeEntwurf(key: string, entwurf: LiveEntwurf): void {
  entwuerfe.set(key, entwurf);
  if (schutz) return;
  schutz = guardUnsavedChanges(() => entwuerfe.size > 0);
  document.addEventListener('astro:before-swap', seiteVerlassen);
}

export function vergissEntwurf(key: string): void {
  entwuerfe.delete(key);
  if (!entwuerfe.size) aufraeumen();
}
