import { anwesend, mahlzeitenReihenfolge } from '../../../api/lib/essen-teilnehmende-model';
import { einheitText } from '../../../api/lib/essen-gerichte-model';
import type { GerichtEinheit, GerichtZutat } from '../../../api/lib/essen-gerichte-model';
import type { Ernaehrung, PlanungGruppe, Teilnehmende } from './types';

/**
 * The amounts of a Planung (`docs/essensplanung.md`, Berechnung): who eats a line of a dish at a
 * meal, how much that is, and the sums for shopping. Checked against the sheet of a real camp
 * (`test/essensplanungRechnung.test.ts`).
 */

/** The units amounts are summed in; kg and l are counted in g and ml. */
export type BasisEinheit = 'g' | 'ml' | 'stueck' | 'packung' | 'bund';

const BASIS: Record<GerichtEinheit, { einheit: BasisEinheit; mal: number }> = {
  g: { einheit: 'g', mal: 1 },
  kg: { einheit: 'g', mal: 1000 },
  ml: { einheit: 'ml', mal: 1 },
  l: { einheit: 'ml', mal: 1000 },
  stueck: { einheit: 'stueck', mal: 1 },
  packung: { einheit: 'packung', mal: 1 },
  bund: { einheit: 'bund', mal: 1 },
};

/** What decides who eats a line. */
export type ZeileFuer = Pick<
  GerichtZutat,
  'fuerAlles' | 'fuerVegetarisch' | 'fuerVegan' | 'ohne' | 'nur'
>;

/** What of a line the amount needs. */
export type ZeileMenge = ZeileFuer & Pick<GerichtZutat, 'menge' | 'einheit' | 'fest'>;

export type RechnungsTeilnehmende = Pick<
  Teilnehmende,
  'gruppeId' | 'ernaehrung' | 'anzahl' | 'unvertraeglichkeiten' | 'vonMahlzeitId' | 'bisMahlzeitId'
>;

export interface RechnungsMahlzeit {
  id: number;
  ohneGruppen: number[];
  einplanungen: { id: number; gerichtId: number; faktor: number }[];
}

export interface RechnungsGericht {
  id: number;
  personen: number;
  zutaten: (ZeileMenge & Pick<GerichtZutat, 'id' | 'planungZutatId'>)[];
}

/** The parts of a Planung the amounts come from. */
export interface RechnungsStand {
  tage: { mahlzeiten: RechnungsMahlzeit[] }[];
  gruppen: Pick<PlanungGruppe, 'id' | 'faktor'>[];
  teilnehmende: RechnungsTeilnehmende[];
  gerichte: RechnungsGericht[];
}

const FUER: Record<
  Ernaehrung,
  keyof Pick<ZeileFuer, 'fuerAlles' | 'fuerVegetarisch' | 'fuerVegan'>
> = {
  alles: 'fuerAlles',
  vegetarisch: 'fuerVegetarisch',
  vegan: 'fuerVegan',
};

/** Whether the people of a row of participants eat a line: their diet, and their intolerances. */
export function isstZeile(zeile: RechnungsTeilnehmende, fuer: ZeileFuer): boolean {
  if (!fuer[FUER[zeile.ernaehrung]]) return false;
  if (zeile.unvertraeglichkeiten.some((id) => fuer.ohne.includes(id))) return false;
  return !fuer.nur.length || zeile.unvertraeglichkeiten.some((id) => fuer.nur.includes(id));
}

/** Counts the eaters of a Planung; the order of its meals is worked out once for all lines. */
export function esserRechner(stand: Pick<RechnungsStand, 'tage' | 'gruppen' | 'teilnehmende'>) {
  const reihenfolge = mahlzeitenReihenfolge(stand.tage);
  const faktor = new Map(stand.gruppen.map((gruppe) => [gruppe.id, gruppe.faktor]));
  /**
   * The weighted eaters of a line at a meal: people times the factor of their group, of the rows
   * present there whose group is not left out and who eat the line.
   */
  return (mahlzeit: Pick<RechnungsMahlzeit, 'id' | 'ohneGruppen'>, fuer: ZeileFuer): number => {
    let summe = 0;
    for (const zeile of stand.teilnehmende) {
      if (mahlzeit.ohneGruppen.includes(zeile.gruppeId)) continue;
      if (!anwesend(zeile, mahlzeit.id, reihenfolge)) continue;
      if (!isstZeile(zeile, fuer)) continue;
      summe += zeile.anzahl * (faktor.get(zeile.gruppeId) ?? 1);
    }
    return summe;
  };
}

/**
 * The amount of a line in its own unit: a fixed amount as it is, otherwise per person of the
 * dish times the eaters and the factor of the planned dish. null without an amount.
 */
export function zeilenMenge(
  zeile: Pick<ZeileMenge, 'menge' | 'fest'>,
  personen: number,
  esser: number,
  faktor: number
): number | null {
  if (zeile.menge === null) return null;
  if (zeile.fest) return zeile.menge;
  return personen > 0 ? (zeile.menge / personen) * esser * faktor : 0;
}

/** An amount in the unit it is summed in. */
export function inBasis(
  menge: number,
  einheit: GerichtEinheit
): { menge: number; einheit: BasisEinheit } {
  const basis = BASIS[einheit];
  return { menge: menge * basis.mal, einheit: basis.einheit };
}

/** What one line of a planned dish needs at its meal. */
export interface Bedarf {
  mahlzeitId: number;
  einplanungId: number;
  gerichtId: number;
  zeileId: number;
  planungZutatId: number;
  /** The weighted eaters of the line; 0 for a fixed amount. */
  esser: number;
  /** In the unit of the line. */
  menge: number;
  einheit: GerichtEinheit;
}

/** Every line with an amount of every planned dish, in the order of the plan. */
export function bedarf(stand: RechnungsStand): Bedarf[] {
  const esser = esserRechner(stand);
  const gerichte = new Map(stand.gerichte.map((gericht) => [gericht.id, gericht]));
  const ergebnis: Bedarf[] = [];
  for (const mahlzeit of stand.tage.flatMap((tag) => tag.mahlzeiten)) {
    for (const einplanung of mahlzeit.einplanungen) {
      const gericht = gerichte.get(einplanung.gerichtId);
      if (!gericht) continue;
      for (const zeile of gericht.zutaten) {
        if (zeile.einheit === null) continue;
        const wer = zeile.fest ? 0 : esser(mahlzeit, zeile);
        const menge = zeilenMenge(zeile, gericht.personen, wer, einplanung.faktor);
        if (menge === null) continue;
        ergebnis.push({
          mahlzeitId: mahlzeit.id,
          einplanungId: einplanung.id,
          gerichtId: gericht.id,
          zeileId: zeile.id,
          planungZutatId: zeile.planungZutatId,
          esser: wer,
          menge,
          einheit: zeile.einheit,
        });
      }
    }
  }
  return ergebnis;
}

/**
 * Ingredients of planned dishes that someone eats but whose line has no amount (salt and pepper
 * „nach Gefühl“): they are bought, just without a number.
 */
export function ohneMenge(stand: RechnungsStand): Set<number> {
  const esser = esserRechner(stand);
  const gerichte = new Map(stand.gerichte.map((gericht) => [gericht.id, gericht]));
  const ergebnis = new Set<number>();
  for (const mahlzeit of stand.tage.flatMap((tag) => tag.mahlzeiten)) {
    for (const einplanung of mahlzeit.einplanungen) {
      for (const zeile of gerichte.get(einplanung.gerichtId)?.zutaten ?? []) {
        if (zeile.menge !== null && zeile.einheit !== null) continue;
        if (esser(mahlzeit, zeile) > 0) ergebnis.add(zeile.planungZutatId);
      }
    }
  }
  return ergebnis;
}

/** The sum of one ingredient in one unit. */
export interface Summe {
  planungZutatId: number;
  einheit: BasisEinheit;
  menge: number;
}

/**
 * Sums the needs per ingredient and unit. An ingredient measured in different kinds of unit (a
 * tin in pieces and in grams) keeps one sum per kind; nothing is converted between them.
 */
export function summiere(liste: Pick<Bedarf, 'planungZutatId' | 'menge' | 'einheit'>[]): Summe[] {
  const summen = new Map<string, Summe>();
  for (const eintrag of liste) {
    const basis = inBasis(eintrag.menge, eintrag.einheit);
    const schluessel = `${eintrag.planungZutatId}:${basis.einheit}`;
    const summe = summen.get(schluessel);
    if (summe) summe.menge += basis.menge;
    else summen.set(schluessel, { planungZutatId: eintrag.planungZutatId, ...basis });
  }
  return [...summen.values()];
}

/**
 * A sum as bought: from 1000 g in kg and from 1000 ml in l, pieces, packs and bunches rounded up.
 * Rounding comes after summing, so the list buys less surplus than rounding per dish.
 */
export function einkaufsMenge(
  menge: number,
  einheit: BasisEinheit
): { menge: number; einheit: GerichtEinheit } {
  if (einheit === 'g')
    return menge >= 1000 ? { menge: menge / 1000, einheit: 'kg' } : { menge, einheit };
  if (einheit === 'ml')
    return menge >= 1000 ? { menge: menge / 1000, einheit: 'l' } : { menge, einheit };
  // A little rounding noise must not buy a whole piece more
  return { menge: Math.ceil(menge - 1e-9), einheit };
}

const ZAHL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/**
 * An amount for cooking, e.g. „2,84 kg“ or „1,5 Packung“: large grams and millilitres in kg and l,
 * nothing rounded up (that is for buying).
 */
export function kochMenge(menge: number, einheit: GerichtEinheit, abtropfgewicht = false): string {
  const basis = inBasis(menge, einheit);
  const gross = basis.menge >= 1000 && (basis.einheit === 'g' || basis.einheit === 'ml');
  const anzeige: GerichtEinheit = gross ? (basis.einheit === 'g' ? 'kg' : 'l') : basis.einheit;
  const wert = gross ? basis.menge / 1000 : basis.menge;
  return `${ZAHL.format(wert)} ${einheitText(anzeige, abtropfgewicht)}`;
}
