/** How a list of the Planung is shown: as a list or as a matrix. */
export type ListenDarstellung = 'liste' | 'matrix';

/** The options of the switch „Liste | Matrix“ (`FilterTabs`, `variant="segmented"`). */
export const DARSTELLUNGEN: readonly { value: ListenDarstellung; label: string }[] = [
  { value: 'liste', label: 'Liste' },
  { value: 'matrix', label: 'Matrix' },
];

export interface GemerkteDarstellung {
  readonly art: ListenDarstellung;
  zeige(art: ListenDarstellung): void;
}

/**
 * The choice between list and matrix under `key`, remembered in this browser for each viewer.
 * Without storage the choice holds until the page is left.
 */
export function darstellungMerken(key: string): GemerkteDarstellung {
  let art = $state<ListenDarstellung>(lesen(key));
  return {
    get art() {
      return art;
    },
    zeige(neu: ListenDarstellung): void {
      art = neu;
      try {
        localStorage.setItem(key, neu);
      } catch {
        // Without storage the choice holds until the page is left
      }
    },
  };
}

function lesen(key: string): ListenDarstellung {
  try {
    return localStorage.getItem(key) === 'matrix' ? 'matrix' : 'liste';
  } catch {
    return 'liste';
  }
}
