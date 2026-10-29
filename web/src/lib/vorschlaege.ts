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

/** How well a shown text fits the typed text: the whole text, its start, a word's start, inside. */
function rang(text: string, search: string): number {
  if (text === search) return 0;
  if (text.startsWith(search)) return 1;
  return text.split(/[\s\-/(),]+/).some((wort) => wort.startsWith(search)) ? 2 : 3;
}

/**
 * Suggestions containing the typed text anywhere, ignoring case; all of them for empty text.
 * The best fitting come first (the whole name, then its start), headings together, so the
 * first suggestion is the one meant. Repeated keys are offered once.
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
  if (search) {
    const rangVon = new Map(all.map((o) => [o, rang(fold(o.label ?? o.value), search)]));
    // A heading goes where its best suggestion goes; within it the order is kept otherwise
    const gruppen = new Map<string, number>();
    for (const o of all) {
      const g = o.gruppe ?? '';
      gruppen.set(g, Math.min(gruppen.get(g) ?? 3, rangVon.get(o)!));
    }
    const reihe = [...gruppen.keys()];
    const gruppe = (o: Vorschlag): string => o.gruppe ?? '';
    all.sort(
      (a, b) =>
        gruppen.get(gruppe(a))! - gruppen.get(gruppe(b))! ||
        reihe.indexOf(gruppe(a)) - reihe.indexOf(gruppe(b)) ||
        rangVon.get(a)! - rangVon.get(b)!
    );
  }
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
