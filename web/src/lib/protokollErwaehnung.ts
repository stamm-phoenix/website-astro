/**
 * Mentioning people with `@` in the text of the minutes (#547): what is being searched for at the
 * cursor and which people match. Shared by the Markdown fields and the formatting editor; the
 * syntax itself is in `api/lib/protokoll-markdown.ts`.
 */
import { erwaehnbar } from '../../../api/lib/protokoll-markdown';
import type { PersonOption } from './types';

export { erwaehnbar, erwaehnungMarkdown } from '../../../api/lib/protokoll-markdown';

/** People offered at most; typing more letters narrows the list. */
export const MAX_TREFFER = 8;

/** An `@` being typed: the letters after it and where the `@` is in the text before the cursor. */
export interface ErwaehnungSuche {
  query: string;
  /** Offset of the `@` from the start of the text passed to `erwaehnungSuche`. */
  start: number;
}

/**
 * `@` at the start or after a space or bracket, then up to two words: first and last name. An
 * `@` inside a word (an e-mail address) starts no search.
 */
const SUCHE = /(?:^|[\s(])@([\p{L}\p{N}.'-]{0,30}(?: [\p{L}\p{N}.'-]{0,30})?)$/u;

/** The search at the end of `textBefore` (the text up to the cursor), or `null`. */
export function erwaehnungSuche(textBefore: string): ErwaehnungSuche | null {
  const match = SUCHE.exec(textBefore);
  if (!match) return null;
  return { query: match[1], start: textBefore.length - match[1].length - 1 };
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss');
}

/**
 * The people matching the letters after the `@`: names starting with them first, then names
 * with a word starting with them, then names containing them; only people with a login, as only
 * they can be notified. Keeps the order of `personen` (leaders first) within each rank.
 */
export function erwaehnungTreffer(
  personen: readonly PersonOption[],
  query: string,
  max = MAX_TREFFER
): PersonOption[] {
  const q = normalize(query.trim());
  const ranked: PersonOption[][] = [[], [], []];
  const seen = new Set<string>();
  for (const person of personen) {
    if (!erwaehnbar(person)) continue;
    const key = person.login.trim().toLowerCase();
    if (seen.has(key)) continue;
    const name = normalize(person.name);
    let rank: number;
    if (name.startsWith(q)) rank = 0;
    else if (name.split(/[\s-]+/).some((word) => word.startsWith(q))) rank = 1;
    else if (q.length >= 2 && (name.includes(q) || normalize(person.login).startsWith(q))) {
      rank = 2;
    } else continue;
    seen.add(key);
    ranked[rank].push(person);
  }
  return ranked.flat().slice(0, max);
}
