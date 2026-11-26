import { z } from 'zod';
import type { GerichtEinheit } from './essen-gerichte-model';

/**
 * What the AI of the Essensplanung answers and how its answers are read (`docs/essensplanung.md`,
 * „KI“): the lines of a pasted recipe mapped onto the ingredient lists and an estimate of grams
 * per TL, EL or piece (the check of a dish: `essen-ki-pruefen-model.ts`). Everything the model
 * says is checked here before the page sees it; the model never changes anything itself. Without
 * database or network, so the mock API uses it too.
 */

/**
 * Units the model may read from a recipe; TL, EL and pieces are converted where the lists know
 * how, else kept as the recipe's own unit. A pinch stays by eye.
 */
export const KI_REZEPT_EINHEITEN = [
  'g',
  'kg',
  'ml',
  'l',
  'stueck',
  'packung',
  'bund',
  'tl',
  'el',
  'prise',
] as const;
export type KiRezeptEinheit = (typeof KI_REZEPT_EINHEITEN)[number];

export type KiZutatWahl = { zutatId: number } | { planungZutatId: number };

/** A line read from a recipe, as the preview shows it before anything is saved. */
export interface KiRezeptZeile {
  /** The line as in the recipe, e.g. „2 EL Olivenöl“. */
  original: string;
  /** The name read from the recipe. */
  name: string;
  /** The ingredient of the lists it stands for; null when none fits. */
  zutat: KiZutatWahl | null;
  menge: number | null;
  einheit: GerichtEinheit | null;
  hinweis: string;
  fuerAlles: boolean;
  fuerVegetarisch: boolean;
  fuerVegan: boolean;
  /**
   * The amount in the recipe's own unit („20 EL“), scaled, when `menge` was converted into the
   * unit of the list; the preview offers to keep it instead.
   */
  rezeptMenge: { menge: number; einheit: GerichtEinheit } | null;
}

export interface KiRezept {
  /** For how many the recipe was written, if it says so. */
  rezeptPersonen: number | null;
  /** The people of the dish the amounts were scaled to; null: the dish has none, amounts as written. */
  personen: number | null;
  zeilen: KiRezeptZeile[];
}

/**
 * A whole dish written by the AI from a short description („Gericht generieren lassen“): the
 * lines like a read recipe, with instructions and tools. Nothing is saved before the member
 * confirms.
 */
export interface KiGericht extends KiRezept {
  /** Instructions in Markdown; empty when the model wrote none. */
  anleitung: string;
  werkzeuge: string[];
}

export const KI_MASSE = ['tl', 'el', 'stueck'] as const;
export type KiMass = (typeof KI_MASSE)[number];

export interface KiUmrechnung {
  mass: KiMass;
  /** Estimated grams of one TL, EL or piece; null when the model cannot say. */
  gramm: number | null;
  begruendung: string;
}

export const KI_MASS_TEXT: Record<KiMass, string> = { tl: 'TL', el: 'EL', stueck: 'Stück' };

export const MAX_MENGE = 1_000_000;
export const MAX_TEXT = 300;
export const MAX_REZEPT_TEXT = 10_000;
/** The description of a dish to write („Gericht generieren lassen“). */
export const MAX_GERICHT_BESCHREIBUNG = 2000;
export const MAX_HINWEISE = 20;

/** Rounds like a cook writes: a tenth below 10, whole numbers above, three places for kg and l. */
export function runde(menge: number, einheit: GerichtEinheit | null): number {
  if (einheit === 'kg' || einheit === 'l') return Math.max(0.001, Math.round(menge * 1000) / 1000);
  const gerundet = menge < 10 ? Math.round(menge * 10) / 10 : Math.round(menge);
  return Math.max(0.1, gerundet);
}

/** A text of one line, cut at `max`; anything but a string is empty. */
export const kiText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''),
    z.string().transform((value) => value.slice(0, max))
  );

/** A positive amount up to a million, else null. */
export const kiZahl = z.preprocess(
  (value) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_MENGE
      ? value
      : null,
  z.number().nullable()
);

const umrechnungSchema = z.object({
  gramm: z.preprocess(
    (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null),
    z.number().nullable()
  ),
  begruendung: kiText(MAX_TEXT),
});

/** Plausible upper limits per measure; a larger estimate is no estimate. */
const MAX_GRAMM: Record<KiMass, number> = { tl: 30, el: 60, stueck: 5000 };

/** Reads the estimate of grams per TL, EL or piece; anything implausible is „cannot say“. */
export function leseKiUmrechnung(raw: unknown, mass: KiMass): KiUmrechnung {
  const antwort = umrechnungSchema.safeParse(raw);
  if (!antwort.success) throw new Error('Invalid answer of the conversion');
  const { gramm, begruendung } = antwort.data;
  const plausibel = gramm !== null && gramm > 0 && gramm <= MAX_GRAMM[mass];
  return {
    mass,
    gramm: plausibel ? Math.max(0.1, Math.round(gramm * 10) / 10) : null,
    begruendung,
  };
}
