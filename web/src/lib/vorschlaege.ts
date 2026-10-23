/** A value offered by `ui/VorschlagFeld.svelte`. */
export interface Vorschlag {
  /** Text taken into the field, or handed to `onpick`. */
  value: string;
  /** Shown text, when it differs from `value`. */
  label?: string;
  /** Further text the search matches, e.g. the login of a person. */
  search?: string;
  /** Heading the suggestion is listed under. */
  gruppe?: string;
  /** Unique key, when the same value may appear twice. */
  key?: string;
}

export interface VorschlagTreffer {
  /** The first matches, in the order of the options. */
  matches: Vorschlag[];
  /** All matches, including those left out by the limit. */
  total: number;
}

const fold = (text: string): string => text.toLocaleLowerCase('de');

/**
 * Suggestions containing the typed text anywhere, ignoring case; all of them for empty text.
 * Repeated keys are offered once.
 */
export function filterVorschlaege(
  options: readonly Vorschlag[],
  query: string,
  max: number
): VorschlagTreffer {
  const search = fold(query.trim());
  const seen = new Set<string>();
  const all = options.filter((option) => {
    const key = option.key ?? option.value;
    // Each suggestion once, even when a list repeats a value
    if (seen.has(key)) return false;
    seen.add(key);
    return (
      !search || fold(`${option.label ?? option.value} ${option.search ?? ''}`).includes(search)
    );
  });
  return { matches: all.slice(0, max), total: all.length };
}

export interface TextTeil {
  text: string;
  /** This part is the typed text. */
  hit: boolean;
}

/** Splits a shown text so the first occurrence of the typed text can be highlighted. */
export function trefferTeile(text: string, query: string): TextTeil[] {
  const search = fold(query.trim());
  const folded = fold(text);
  const start = search ? folded.indexOf(search) : -1;
  // Lowercasing may change the length of rare letters; then the positions would not fit
  if (start < 0 || folded.length !== text.length) return [{ text, hit: false }];
  const end = start + search.length;
  return [
    { text: text.slice(0, start), hit: false },
    { text: text.slice(start, end), hit: true },
    { text: text.slice(end), hit: false },
  ].filter((part) => part.text);
}
