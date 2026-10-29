import type { EssenEinheitenart } from './essen-validation';

/**
 * Dishes of a Planung and the ingredients they use: types, units and the warnings the page shows.
 * Without imports, so the website uses it too; the checks of the input are in
 * `essen-gerichte-validation.ts` (`docs/essensplanung.md`, „Gerichte“).
 */

export type GerichtEinheit = 'g' | 'kg' | 'ml' | 'l' | 'stueck' | 'packung' | 'bund';

/** The units a line may use; nothing is ever converted between kinds of unit. */
export const EINHEITEN_JE_ART: Record<EssenEinheitenart, readonly GerichtEinheit[]> = {
  masse: ['g', 'kg'],
  volumen: ['ml', 'l'],
  stueck: ['stueck'],
  packung: ['packung'],
  bund: ['bund'],
};

export const EINHEIT_TEXT: Record<GerichtEinheit, string> = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  stueck: 'Stück',
  packung: 'Packung',
  bund: 'Bund',
};

export const MAX_GERICHTE = 300;
export const MAX_ZEILEN_PRO_GERICHT = 60;
export const MAX_PLANUNG_ZUTATEN = 1000;
export const MAX_WERKZEUGE = 30;
export const MAX_LINKS = 10;

/** An ingredient of the central list as a Planung picks it. */
export interface KatalogZutat {
  id: number;
  name: string;
  kategorieId: number;
  einheitenart: EssenEinheitenart;
  abtropfgewicht: boolean;
  lebensmittel: boolean;
  vegetarisch: boolean | null;
  vegan: boolean | null;
  allergene: number[];
  grammProTl: number | null;
  grammProEl: number | null;
  grammProStueck: number | null;
}

/** The central lists a Planung picks from; they change only in the Steuerung. */
export interface EssenKatalog {
  kategorien: { id: number; name: string }[];
  unvertraeglichkeiten: { id: number; name: string; schluessel: string | null }[];
  zutaten: KatalogZutat[];
}

/** An ingredient used in a Planung with what applies there. */
export interface PlanungZutat {
  id: number;
  etag: string;
  /** The central ingredient; null for one of the Planung's own. */
  zutatId: number | null;
  name: string;
  kategorieId: number;
  einheitenart: EssenEinheitenart;
  abtropfgewicht: boolean;
  lebensmittel: boolean;
  vegetarisch: boolean | null;
  vegan: boolean | null;
  allergene: number[];
  /** Which fields of a central ingredient differ in this Planung. */
  abweichend: { kategorie: boolean; einheitenart: boolean };
  /** How many lines of dishes, stock and extra needs use it; a used one cannot be deleted. */
  zeilen: number;
  /** The shop it is bought at; null: none yet. */
  geschaeftId: number | null;
}

export interface GerichtLink {
  titel: string;
  url: string;
}

export interface GerichtZutat {
  id: number;
  etag: string;
  position: number;
  planungZutatId: number;
  /** null: without an amount, e.g. spices by eye. */
  menge: number | null;
  einheit: GerichtEinheit | null;
  /** The amount is for the whole dish and scales neither with the eaters nor the factor. */
  fest: boolean;
  fuerAlles: boolean;
  fuerVegetarisch: boolean;
  fuerVegan: boolean;
  /** IDs of `essen.unvertraeglichkeit`: „nicht für …“. */
  ohne: number[];
  /** A replacement line „nur für …“. */
  nur: number[];
  hinweis: string;
}

export interface Gericht {
  id: number;
  etag: string;
  name: string;
  /** The amounts of the lines are for this many people. */
  personen: number;
  anleitung: string;
  notiz: string;
  links: GerichtLink[];
  werkzeuge: string[];
  zutaten: GerichtZutat[];
}

/** Whether `einheit` fits an ingredient of `art`, e.g. kg for mass. */
export function einheitPasst(art: EssenEinheitenart, einheit: GerichtEinheit | null): boolean {
  return einheit === null || EINHEITEN_JE_ART[art].includes(einheit);
}

/**
 * Lock of a central ingredient: saving a line that measures it in its inherited kind of unit and
 * changing that kind in the Steuerung run one after the other.
 */
export function zutatSperre(zutatId: number): string {
  return `essen-zutat:${zutatId}`;
}

/** The lock that serializes changes of the lines of a dish against deleting it. */
export function gerichtSperre(gerichtId: number): string {
  return `essen-gericht:${gerichtId}`;
}

/**
 * The version a dish is deleted with: the newest of the dish, its lines and `weitere` (where it
 * is planned at meals). Versions grow with every change, so a changed or added line makes it
 * newer and deleting with the old one fails.
 */
export function gerichtStand(
  gericht: { etag: string; zutaten: { etag: string }[] },
  weitere: string[] = []
): string {
  return [...gericht.zutaten.map((zeile) => zeile.etag), ...weitere].reduce(
    (neueste, etag) => (etag > neueste ? etag : neueste),
    gericht.etag
  );
}

export interface GerichtWarnung {
  /** The line it is about; missing for the dish as a whole. */
  zeileId?: number;
  text: string;
}

const FORMEN = [
  { feld: 'fuerAlles', label: 'alle, die alles essen' },
  { feld: 'fuerVegetarisch', label: 'vegetarisch Essende' },
  { feld: 'fuerVegan', label: 'vegan Essende' },
] as const;

/**
 * Warnings from the properties of the ingredients, before asking the AI: a line for vegetarians
 * with meat, and a diet that gets no line of the dish at all. Allergens are shown on the lines;
 * whether anyone is affected depends on the participants.
 */
export function gerichtWarnungen(
  gericht: Gericht,
  zutaten: ReadonlyMap<number, PlanungZutat>
): GerichtWarnung[] {
  const warnungen: GerichtWarnung[] = [];
  for (const zeile of gericht.zutaten) {
    const zutat = zutaten.get(zeile.planungZutatId);
    if (!zutat) continue;
    if (zeile.fuerVegetarisch && zutat.vegetarisch === false) {
      warnungen.push({
        zeileId: zeile.id,
        text: `${zutat.name} ist nicht vegetarisch, die Zeile gilt aber für vegetarisch Essende.`,
      });
    } else if (zeile.fuerVegan && zutat.vegan === false) {
      warnungen.push({
        zeileId: zeile.id,
        text: `${zutat.name} ist nicht vegan, die Zeile gilt aber für vegan Essende.`,
      });
    }
  }
  // Replacement lines („nur für …“) feed only some people
  const fuerAlle = gericht.zutaten.filter((zeile) => zeile.nur.length === 0);
  if (gericht.zutaten.length) {
    for (const form of FORMEN) {
      if (!fuerAlle.some((zeile) => zeile[form.feld])) {
        warnungen.push({ text: `Für ${form.label} gibt es in diesem Gericht keine Zutat.` });
      }
    }
  }
  return warnungen;
}

/** The amount of a line as shown, e.g. „1,5 kg“; null without an amount. */
export function mengeText(
  menge: number | null,
  einheit: GerichtEinheit | null,
  abtropfgewicht = false
): string | null {
  if (menge === null || einheit === null) return null;
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 }).format(menge)} ${einheitText(einheit, abtropfgewicht)}`;
}

/** The unit as shown, e.g. „kg (ATG)“ for the drained weight of tins and jars. */
export function einheitText(einheit: GerichtEinheit, abtropfgewicht = false): string {
  return abtropfgewicht && (einheit === 'g' || einheit === 'kg')
    ? `${EINHEIT_TEXT[einheit]} (ATG)`
    : EINHEIT_TEXT[einheit];
}

/** The fields of a dish; on a change only those sent. */
export interface GerichtInput {
  name?: string;
  personen?: number;
  anleitung?: string;
  notiz?: string;
  links?: GerichtLink[];
  werkzeuge?: string[];
}

/** A line of a dish; the ingredient is a central one or one of the Planung. */
export interface GerichtZutatInput {
  zutat: { zutatId: number } | { planungZutatId: number };
  menge: number | null;
  einheit: GerichtEinheit | null;
  fest: boolean;
  fuerAlles: boolean;
  fuerVegetarisch: boolean;
  fuerVegan: boolean;
  ohne: number[];
  nur: number[];
  hinweis: string;
}

/** Fields of an ingredient of the Planung's own, or the differences of a central one. */
export interface PlanungZutatInput {
  name?: string;
  kategorieId: number | null;
  einheitenart: EssenEinheitenart | null;
  vegetarisch?: boolean | null;
  vegan?: boolean | null;
  allergene?: number[];
}
