import type { EinkaufPosten, ZusatzPosten } from './essen-einkauf-model';
import type { Gericht, GerichtEinheit } from './essen-gerichte-model';
import { einheitBasis, einheitSchluessel } from './essen-gerichte-model';

/**
 * Units of one ingredient brought into line (`docs/essensplanung.md`, „Einheiten“): where an
 * ingredient of a Planung is measured in different base units (dishes in Bund, extra needs in g),
 * the page offers to convert the amounts into one unit. The AI proposes the unit and the factors;
 * the page shows the result and saves only what the member confirms. Without imports of zod, so
 * the website uses it too.
 */

/** Where an amount of an ingredient stands. */
export type EinheitenStelle = 'gericht' | 'zusatzbedarf' | 'bestand';

/** One amount of an ingredient, as it is converted. */
export interface EinheitenVorkommen {
  stelle: EinheitenStelle;
  id: number;
  etag: string;
  menge: number;
  einheit: GerichtEinheit;
  /** Where it is, e.g. „Chili sin Carne“ or „Zusatzbedarf“. */
  wo: string;
  /** People of the dish, for the AI; null outside a dish. */
  personen: number | null;
}

/** The parts of a Planung that hold amounts. */
export interface EinheitenStand {
  gerichte: Pick<Gericht, 'name' | 'personen' | 'zutaten'>[];
  zusatzbedarf: Pick<ZusatzPosten, 'id' | 'etag' | 'planungZutatId' | 'menge' | 'einheit'>[];
  bestand: Pick<EinkaufPosten, 'id' | 'etag' | 'planungZutatId' | 'menge' | 'einheit'>[];
}

/** Most amounts converted at once: every line, extra need and stock of one ingredient. */
export const MAX_EINHEITEN_ZEILEN = 2000;

const STELLE_TEXT: Record<Exclude<EinheitenStelle, 'gericht'>, string> = {
  zusatzbedarf: 'Zusatzbedarf',
  bestand: 'Bestand',
};

/** Every amount of `planungZutatId`: lines of dishes, extra needs and stock with an amount. */
export function einheitenVorkommen(
  stand: EinheitenStand,
  planungZutatId: number
): EinheitenVorkommen[] {
  const ergebnis: EinheitenVorkommen[] = [];
  for (const gericht of stand.gerichte)
    for (const zeile of gericht.zutaten)
      if (zeile.planungZutatId === planungZutatId && zeile.menge !== null && zeile.einheit)
        ergebnis.push({
          stelle: 'gericht',
          id: zeile.id,
          etag: zeile.etag,
          menge: zeile.menge,
          einheit: zeile.einheit,
          wo: gericht.name,
          personen: zeile.fest ? null : gericht.personen,
        });
  for (const stelle of ['zusatzbedarf', 'bestand'] as const)
    for (const posten of stand[stelle])
      if (posten.planungZutatId === planungZutatId && posten.menge !== null && posten.einheit)
        ergebnis.push({
          stelle,
          id: posten.id,
          etag: posten.etag,
          menge: posten.menge,
          einheit: posten.einheit,
          wo: STELLE_TEXT[stelle],
          personen: null,
        });
  return ergebnis;
}

/**
 * The ingredients whose amounts stand in more than one base unit (kg and g are one), with those
 * units as first written; these are offered to be brought into line.
 */
export function uneinheitlicheZutaten(stand: EinheitenStand): Map<number, GerichtEinheit[]> {
  const je = new Map<number, Map<string, GerichtEinheit>>();
  const merke = (id: number, einheit: GerichtEinheit | null, menge: number | null) => {
    if (!einheit || menge === null) return;
    const einheiten = je.get(id) ?? new Map<string, GerichtEinheit>();
    je.set(id, einheiten);
    const basis = einheitSchluessel(einheit);
    if (!einheiten.has(basis)) einheiten.set(basis, einheitBasis(einheit).einheit);
  };
  for (const gericht of stand.gerichte)
    for (const zeile of gericht.zutaten) merke(zeile.planungZutatId, zeile.einheit, zeile.menge);
  for (const posten of [...stand.zusatzbedarf, ...stand.bestand])
    merke(posten.planungZutatId, posten.einheit, posten.menge);
  return new Map(
    [...je].filter(([, einheiten]) => einheiten.size > 1).map(([id, e]) => [id, [...e.values()]])
  );
}

/** The units of `vorkommen`, each once (upper and lower case alike), as written first. */
export function vorkommendeEinheiten(
  vorkommen: readonly Pick<EinheitenVorkommen, 'einheit'>[]
): GerichtEinheit[] {
  const gesehen = new Map<string, GerichtEinheit>();
  for (const eintrag of vorkommen) {
    const key = eintrag.einheit.toLocaleLowerCase('de');
    if (!gesehen.has(key)) gesehen.set(key, eintrag.einheit);
  }
  return [...gesehen.values()];
}

/** How many of `nach` one `von` is, where that is certain (g and kg, ml and l); else null. */
export function sichererFaktor(von: GerichtEinheit, nach: GerichtEinheit): number | null {
  if (einheitSchluessel(von) !== einheitSchluessel(nach)) return null;
  return einheitBasis(von).mal / einheitBasis(nach).mal;
}

/** A converted amount rounded like a cook writes it: three places, two for counted units. */
export function rundeMenge(menge: number, einheit: GerichtEinheit): number {
  const stellen =
    ['g', 'ml'].includes(einheit) && menge >= 10 ? 0 : einheit === 'kg' || einheit === 'l' ? 3 : 2;
  const faktor = 10 ** stellen;
  return Math.max(0.001, Math.round(menge * faktor) / faktor);
}

/** The AI's proposal for one ingredient: a target unit and, per unit found, its factor. */
export interface KiEinheiten {
  planungZutatId: number;
  /** The unit all amounts are converted into, e.g. „Bund“ for herbs. */
  ziel: GerichtEinheit;
  /** One sentence why; empty when the model gives none. */
  begruendung: string;
  /** Per unit found: how many of `ziel` one of it is; null when the model cannot say. */
  faktoren: { einheit: GerichtEinheit; faktor: number | null }[];
}

/** An amount converted, as the page sends it to be saved with the version it saw. */
export interface EinheitenZeileInput {
  stelle: EinheitenStelle;
  id: number;
  etag: string;
  menge: number;
  einheit: GerichtEinheit;
}
