import type { GerichtEinheit } from './essen-gerichte-model';

/**
 * Ticking off a planned dish after its meal: cooked with what it really used, or left out
 * (`docs/essensplanung.md`, Kochen abhaken). Without zod, so the page uses it too; the checks are
 * in `essen-kochen-validation.ts`.
 */

/** offen: still needed; gekocht: used its `verbrauch`; ausgelassen: needs and uses nothing. */
export type EinplanungStatus = 'offen' | 'gekocht' | 'ausgelassen';

export const EINPLANUNG_STATUS: readonly EinplanungStatus[] = ['offen', 'gekocht', 'ausgelassen'];

/** What a cooked dish used of one ingredient in one unit; 0 for „not used“. */
export interface Verbrauch {
  planungZutatId: number;
  menge: number;
  einheit: GerichtEinheit;
}

export interface AbhakenInput {
  status: EinplanungStatus;
  /** Only when cooked; one entry per ingredient and unit. */
  verbrauch: Verbrauch[];
}

/** Entries of one cooked dish. */
export const MAX_VERBRAUCH = 200;
