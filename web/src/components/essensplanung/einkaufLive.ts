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
