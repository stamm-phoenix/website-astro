import { z } from 'zod';
import type { Gericht, GerichtEinheit, GerichtZutat, PlanungZutat } from './essen-gerichte-model';
import { EINHEITEN_JE_ART, einheitSchluessel, istBekannteEinheit } from './essen-gerichte-model';
import type { EssenEinheitenart } from './essen-validation';

/**
 * What the AI of the Essensplanung answers and how its answers are read (`docs/essensplanung.md`,
 * „KI“): hints on a dish, the lines of a pasted recipe mapped onto the ingredient lists, and an
 * estimate of grams per TL, EL or piece. Everything the model says is checked here before the
 * page sees it; the model never changes anything itself. Without database or network, so the
 * mock API uses it too.
 */

export const KI_HINWEIS_ARTEN = [
  'menge',
  'tippfehler',
  'ernaehrung',
  'unvertraeglichkeit',
  'fehlt',
  'sonstiges',
] as const;
export type KiHinweisArt = (typeof KI_HINWEIS_ARTEN)[number];

/** A change of a line the page can take over with one click. */
export interface KiAenderung {
  menge?: number;
  einheit?: GerichtEinheit;
  fuerAlles?: boolean;
  fuerVegetarisch?: boolean;
  fuerVegan?: boolean;
}

export interface KiHinweis {
  art: KiHinweisArt;
  /** The line it is about, with the version that was checked; missing for the whole dish. */
  zeile?: { id: number; etag: string };
  text: string;
  vorschlag: string;
  aenderung?: KiAenderung;
}

export interface KiPruefung {
  hinweise: KiHinweis[];
  /** The people of the dish that was checked; taking over an amount sends them back. */
  personen: number;
}

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
  /** The people of the dish the amounts were scaled to. */
  personen: number;
  zeilen: KiRezeptZeile[];
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
const MAX_TEXT = 300;
export const MAX_REZEPT_TEXT = 10_000;
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

const flag = z.preprocess(
  (value) => (typeof value === 'boolean' ? value : null),
  z.boolean().nullable()
);

const liste = z.object({ hinweise: z.array(z.unknown()) });

const hinweisSchema = z.object({
  art: z.preprocess(
    (value) => (KI_HINWEIS_ARTEN.some((art) => art === value) ? value : 'sonstiges'),
    z.enum(KI_HINWEIS_ARTEN)
  ),
  zeile: z.preprocess((value) => (Number.isInteger(value) ? value : null), z.number().nullable()),
  text: kiText(MAX_TEXT).refine((value) => value !== ''),
  vorschlag: kiText(MAX_TEXT),
  menge: kiZahl,
  einheit: z.preprocess(
    (value) => (typeof value === 'string' && istBekannteEinheit(value) ? value : null),
    z.custom<GerichtEinheit>().nullable()
  ),
  fuerAlles: flag,
  fuerVegetarisch: flag,
  fuerVegan: flag,
});

/** Whether a proposed unit fits: the line's base unit, or for a line without one the ingredient's. */
function einheitBleibt(
  einheit: GerichtEinheit,
  zeile: GerichtZutat,
  art: EssenEinheitenart | undefined
): boolean {
  if (zeile.einheit) return einheitSchluessel(einheit) === einheitSchluessel(zeile.einheit);
  return art !== undefined && EINHEITEN_JE_ART[art].some((bekannt) => bekannt === einheit);
}

/** The change a hint proposes for `zeile`, if it changes anything and keeps its base unit. */
function aenderungFuer(
  hinweis: z.infer<typeof hinweisSchema>,
  zeile: GerichtZutat,
  art: EssenEinheitenart | undefined
): KiAenderung | undefined {
  const aenderung: KiAenderung = {};
  if (hinweis.menge !== null) {
    const einheit = hinweis.einheit ?? zeile.einheit;
    // A new amount stays in the base unit of the line: 500 ml of pasta is no proposal
    if (einheit && einheitBleibt(einheit, zeile, art)) {
      const menge = Math.round(hinweis.menge * 1000) / 1000 || 0.001;
      if (menge !== zeile.menge || einheit !== zeile.einheit) {
        aenderung.menge = menge;
        aenderung.einheit = einheit;
      }
    }
  }
  const fuer = {
    fuerAlles: hinweis.fuerAlles ?? zeile.fuerAlles,
    fuerVegetarisch: hinweis.fuerVegetarisch ?? zeile.fuerVegetarisch,
    fuerVegan: hinweis.fuerVegan ?? zeile.fuerVegan,
  };
  // A line must stay for at least one diet
  if (fuer.fuerAlles || fuer.fuerVegetarisch || fuer.fuerVegan) {
    for (const feld of ['fuerAlles', 'fuerVegetarisch', 'fuerVegan'] as const) {
      if (fuer[feld] !== zeile[feld]) aenderung[feld] = fuer[feld];
    }
  }
  return Object.keys(aenderung).length ? aenderung : undefined;
}

/** Field names of the data the model sees, and how the page says them. */
const FELDNAMEN: [RegExp, string][] = [
  [/\bnichtFuer\b/g, 'nicht bei'],
  [/\bnurFuer\b/g, 'nur bei'],
  [/\bfuerAlles\b/g, 'für alle, die alles essen'],
  [/\bfuerVegetarisch\b/g, 'vegetarisch'],
  [/\bfuerVegan\b/g, 'vegan'],
  [/\beinheitenart\b/g, 'Einheit'],
  [/\benthaelt\b/g, 'enthält'],
];
/** Internal ids that say nothing to a person; a text with them is left out. */
const INTERN = /\b(?:planungZutatId|zutatId|gerichtId|etag)\b/;

/**
 * A hint's text in the words of the page: field names the model may echo are replaced; null for
 * a text with internal ids.
 */
export function oberflaechenText(text: string): string | null {
  if (INTERN.test(text)) return null;
  return FELDNAMEN.reduce((ergebnis, [muster, wort]) => ergebnis.replace(muster, wort), text);
}

/**
 * Reads the hints of the model on `gericht`: entries that do not fit are left out, a line number
 * outside the dish counts for the whole dish, and a proposed change only stays when it keeps the
 * base unit of the line and leaves it for at least one diet.
 */
export function leseKiPruefung(
  raw: unknown,
  gericht: Gericht,
  zutaten: ReadonlyMap<number, PlanungZutat>
): KiPruefung {
  const antwort = liste.safeParse(raw);
  if (!antwort.success) throw new Error('Invalid answer of the check');
  const hinweise: KiHinweis[] = [];
  for (const value of antwort.data.hinweise) {
    if (hinweise.length >= MAX_HINWEISE) break;
    const eintrag = hinweisSchema.safeParse(value);
    if (!eintrag.success) continue;
    const hinweis = eintrag.data;
    const text = oberflaechenText(hinweis.text);
    const vorschlag = oberflaechenText(hinweis.vorschlag);
    if (text === null || vorschlag === null) continue;
    const zeile =
      hinweis.zeile !== null && hinweis.zeile >= 1 ? gericht.zutaten[hinweis.zeile - 1] : undefined;
    const aenderung = zeile
      ? aenderungFuer(hinweis, zeile, zutaten.get(zeile.planungZutatId)?.einheitenart)
      : undefined;
    hinweise.push({
      art: hinweis.art,
      ...(zeile ? { zeile: { id: zeile.id, etag: zeile.etag } } : {}),
      text,
      vorschlag,
      ...(aenderung ? { aenderung } : {}),
    });
  }
  return { hinweise, personen: gericht.personen };
}

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
