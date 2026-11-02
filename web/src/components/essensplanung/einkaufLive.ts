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

/**
 * Rows of the live mode on screen by `<einkaufId>:<key>`, the key of the thing on the list
 * (`<planungZutatId>:<Basiseinheit>`, or `<planungZutatId>:` without an amount), counted.
 */
export const sichtbar = new Map<string, number>();

/** Unsaved input of a row of the live mode, kept while the trip shows its list or form. */
export interface LiveEntwurf {
  menge: string;
  einheit: GerichtEinheit;
  ersatz: string;
  etag: string | null;
  konflikt: string | null;
}

/**
 * Unsaved input by `<einkaufId>:<key>` as for `sichtbar`, also of rows not on screen now: the same
 * ingredient in g and in Bund keeps two.
 */
export const entwuerfe = new Map<string, LiveEntwurf>();

/** The row whose amount is open, by trip, so it opens again when coming back. */
export const offeneZeile = new Map<number, string>();

/**
 * An unsaved fixed amount in the list of a trip, by `<einkaufId>:<planungZutatId>`: a trip has one
 * fixed amount per ingredient, whatever unit its things stand in.
 */
export interface FestEntwurf {
  menge: string;
  einheit: GerichtEinheit;
}

export const festeEntwuerfe = new Map<string, FestEntwurf>();

let schutz: (() => void) | null = null;

const ungespeichert = (): boolean => entwuerfe.size > 0 || festeEntwuerfe.size > 0;

/**
 * Drops all kept input once the page of the Planung is really left (the navigation went ahead,
 * after „Änderungen verwerfen“); a navigation that was cancelled keeps it.
 */
function seiteVerlassen(): void {
  entwuerfe.clear();
  festeEntwuerfe.clear();
  offeneZeile.clear();
  aufraeumen();
}

function aufraeumen(): void {
  if (!schutz || ungespeichert()) return;
  schutz();
  schutz = null;
  document.removeEventListener('astro:before-swap', seiteVerlassen);
}

/** Leaving the page asks first while there is unsaved input. */
function schuetzen(): void {
  if (schutz) return;
  schutz = guardUnsavedChanges(ungespeichert);
  document.addEventListener('astro:before-swap', seiteVerlassen);
}

/** Keeps unsaved input of the live mode. */
export function merkeEntwurf(key: string, entwurf: LiveEntwurf): void {
  entwuerfe.set(key, entwurf);
  schuetzen();
}

export function vergissEntwurf(key: string): void {
  entwuerfe.delete(key);
  aufraeumen();
}

/** Keeps an unsaved fixed amount, also when another thing is opened meanwhile. */
export function merkeFest(key: string, entwurf: FestEntwurf): void {
  festeEntwuerfe.set(key, entwurf);
  schuetzen();
}

export function vergissFest(key: string): void {
  festeEntwuerfe.delete(key);
  aufraeumen();
}
