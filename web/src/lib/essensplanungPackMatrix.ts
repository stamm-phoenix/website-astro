/**
 * Moving the focus in the packing list as a matrix (`PackMatrix.svelte`); the columns are in
 * `essensplanungPackSpalten.ts`.
 */

/** A cell of the matrix: row index, column index (0 the thing, 1 „gepackt“, then the persons). */
export interface PackZelle {
  zeile: number;
  spalte: number;
}

/**
 * The cell a key moves the focus to, like in a spreadsheet: arrows, Home/End in the row,
 * Ctrl+Home/End to the corners, PageUp/PageDown by `seite` rows. null: the key does not move.
 */
export function naechsteZelle(
  von: PackZelle,
  taste: { key: string; ctrlKey?: boolean; metaKey?: boolean },
  zeilen: number,
  spalten: number,
  seite = 10
): PackZelle | null {
  if (!zeilen || !spalten) return null;
  const strg = taste.ctrlKey || taste.metaKey;
  let { zeile, spalte } = von;
  switch (taste.key) {
    case 'ArrowUp':
      zeile--;
      break;
    case 'ArrowDown':
      zeile++;
      break;
    case 'ArrowLeft':
      spalte--;
      break;
    case 'ArrowRight':
      spalte++;
      break;
    case 'Home':
      spalte = 0;
      if (strg) zeile = 0;
      break;
    case 'End':
      spalte = spalten - 1;
      if (strg) zeile = zeilen - 1;
      break;
    case 'PageUp':
      zeile -= seite;
      break;
    case 'PageDown':
      zeile += seite;
      break;
    default:
      return null;
  }
  return {
    zeile: Math.min(Math.max(zeile, 0), zeilen - 1),
    spalte: Math.min(Math.max(spalte, 0), spalten - 1),
  };
}
