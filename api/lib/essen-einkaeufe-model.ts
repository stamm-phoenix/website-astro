import type { GerichtEinheit } from './essen-gerichte-model';

/**
 * Shopping trips of a Planung (`docs/essensplanung.md`, Einkäufe): which meals and shop they
 * cover, what was ticked off while shopping and the rules set by hand. The list of a trip is
 * worked out by the page (`web/src/lib/essensplanungEinkaeufe.ts`). Without zod, so the page uses
 * it too; the checks are in `essen-einkaeufe-validation.ts`.
 */

export const MAX_EINKAEUFE = 30;
/** Ticked off things and rules of one trip, each. */
export const MAX_EINKAUF_EINTRAEGE = 1000;

/**
 * ohne: not on this trip; mit: on this trip although it belongs to another shop; fest: exactly
 * this amount on this trip.
 */
export type EinkaufRegelArt = 'ohne' | 'mit' | 'fest';

export const EINKAUF_REGEL_ARTEN: readonly EinkaufRegelArt[] = ['ohne', 'mit', 'fest'];

export interface EinkaufRegel {
  planungZutatId: number;
  art: EinkaufRegelArt;
  /** Only with `fest`. */
  menge: number | null;
  einheit: GerichtEinheit | null;
  /** An `ohne` made by moving names the trip it was moved to; absent when set by hand. */
  verschobenNach?: number;
}

/** A thing ticked off while shopping, with what was really bought. */
export interface EinkaufHaken {
  id: number;
  etag: string;
  planungZutatId: number;
  einheit: GerichtEinheit;
  /** 0 for a thing without an amount, or when there was none. */
  erhalten: number;
  /** What was bought instead, e.g. „Pepsi Cola“; empty for the thing itself. */
  ersatz: string;
  /** Name of the member who ticked it off; empty when unknown. */
  von: string;
  /** ISO time. */
  am: string;
  /**
   * The state of the database when it was ticked off, compared like versions; unlike `etag` it
   * does not change when its unit is brought into line. Tells whether a thing without an amount
   * was put on the list again afterwards. Missing in older answers: then the version counts.
   */
  stand?: string;
}

export interface Einkauf {
  id: number;
  etag: string;
  position: number;
  name: string;
  /** `YYYY-MM-DD` or null. */
  datum: string | null;
  /** null: every shop. */
  geschaeftId: number | null;
  /** Covers the open meals up to this one; null (or a deleted meal): all of them. */
  bisMahlzeitId: number | null;
  abgeschlossen: boolean;
  posten: EinkaufHaken[];
  regeln: EinkaufRegel[];
}

export interface EinkaufInput {
  name: string;
  datum: string | null;
  geschaeftId: number | null;
  bisMahlzeitId: number | null;
  abgeschlossen: boolean;
}

/** Ticking off one thing; `etag` is that of the thing ticked off before, or null for none. */
export interface HakenInput {
  planungZutatId: number;
  einheit: GerichtEinheit;
  erhalten: number;
  ersatz: string;
}

/** A rule for one ingredient on one trip; `art` null takes the rule away. */
export interface RegelInput {
  planungZutatId: number;
  art: EinkaufRegelArt | null;
  menge: number | null;
  einheit: GerichtEinheit | null;
}

/** Moves an ingredient from one trip to another: „ohne“ there, „mit“ here. */
export interface VerschiebenInput {
  planungZutatId: number;
  nachEinkaufId: number;
}

/** Takes back „not on this trip“, with the „mit“ of the trip it was moved to. */
export interface ZurueckholenInput {
  planungZutatId: number;
}

/** The version a trip is deleted with: of the trip and everything ticked off on it. */
export function einkaufStand(einkauf: { etag: string; posten: { etag: string }[] }): string {
  return [einkauf.etag, ...einkauf.posten.map((p) => p.etag)].reduce(
    (neueste, etag) => (etag > neueste ? etag : neueste),
    ''
  );
}
