/** Types of the next Leitendenrunde that the browser shares with the API. No imports. */

export const TERMIN_EXTRACTIONS = [
  'gefunden',
  'unklar',
  'nicht gefunden',
  'fehler',
  'nicht eingerichtet',
  'nicht ausgefuehrt',
] as const;

export const TERMIN_DECISIONS = ['offen', 'bestaetigt', 'abgelehnt'] as const;

export type TerminExtraction = (typeof TERMIN_EXTRACTIONS)[number];

export type TerminDecision = (typeof TERMIN_DECISIONS)[number];

export interface TerminSuggestion {
  /** `YYYY-MM-DD` */
  date: string | null;
  /** `HH:MM` */
  time: string | null;
  place: string | null;
  /** The passage of the minutes the suggestion comes from, verbatim. */
  quote: string | null;
}

export interface ConfirmedTermin {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:MM` */
  time: string | null;
  place: string | null;
}

/** Suggestion and decision as stored in the column `Termin` and sent to the browser. */
export interface ProtokollTermin {
  /** cTag of the file version the suggestion was read from. */
  sourceVersion: string;
  extraction: TerminExtraction;
  suggestion: TerminSuggestion;
  decision: TerminDecision;
  /** The date a leader confirmed; only with `bestaetigt`. */
  confirmed: ConfirmedTermin | null;
  decidedBy: string;
  decidedAt: string;
  extractedAt: string;
}
