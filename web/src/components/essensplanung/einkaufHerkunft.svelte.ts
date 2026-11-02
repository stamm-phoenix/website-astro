/**
 * Whether the shopping lists name the dishes each thing is for („Für welche Gerichte“); one
 * choice for the shopping list, the lists of the trips and the live mode, remembered in this
 * browser.
 */

const KEY = 'essensplanung:herkunft';

function gemerkt(): boolean {
  try {
    return localStorage.getItem(KEY) === 'an';
  } catch {
    return false;
  }
}

export const herkunftAnzeige = $state({ an: gemerkt() });

export function zeigeHerkunft(an: boolean): void {
  herkunftAnzeige.an = an;
  try {
    localStorage.setItem(KEY, an ? 'an' : 'aus');
  } catch {
    // Without storage the choice holds until the page is left
  }
}

/** A small field in a row of the shopping lists; full size where touched with a finger. */
export const FELD =
  'form-input mt-0 min-h-8 px-2 py-1 text-base pointer-fine:text-sm any-pointer-coarse:min-h-11';

/** A small button in a row of the shopping lists; full size where touched with a finger. */
export const KNOPF = 'min-h-8 px-2.5 py-1 any-pointer-coarse:min-h-11';
