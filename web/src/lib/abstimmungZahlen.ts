// Counts of an Abstimmung in words, for its pages and its PDF; free of the stores.
import type { AbstimmungErgebnis } from '../../../api/lib/abstimmung-model';

/** IDs of the options with the most votes; none while nobody chose anything. */
export function spitzenreiter(ergebnis: Pick<AbstimmungErgebnis, 'optionen'>): Set<number> {
  const most = Math.max(0, ...ergebnis.optionen.map((option) => option.stimmen));
  if (most === 0) return new Set();
  return new Set(ergebnis.optionen.filter((o) => o.stimmen === most).map((o) => o.id));
}

/** „1 Antwort“, „3 Antworten“. */
export function antwortenText(count: number): string {
  return count === 1 ? '1 Antwort' : `${count} Antworten`;
}

/** „1 Stimme“, „3 Stimmen“. */
export function stimmenText(count: number): string {
  return count === 1 ? '1 Stimme' : `${count} Stimmen`;
}
