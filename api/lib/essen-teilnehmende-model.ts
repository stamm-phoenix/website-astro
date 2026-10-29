/**
 * Groups and participants of a Planung and who eats at which meal, without database access, so
 * the page and the mock API use the same rules (`docs/essensplanung.md`, Teilnehmende). The
 * checks of the forms are in `essen-teilnehmende-validation.ts`; this file stays free of zod.
 */

export type Ernaehrung = 'alles' | 'vegetarisch' | 'vegan';
export const ERNAEHRUNGEN: Ernaehrung[] = ['alles', 'vegetarisch', 'vegan'];

export const MAX_GRUPPEN = 20;
export const MAX_TEILNEHMENDE = 300;

/** A group of a Planung, e.g. „Wö“ with factor 0.7 (eats 70 % of a portion). */
export interface PlanungGruppe {
  id: number;
  etag: string;
  position: number;
  name: string;
  faktor: number;
}

/** So many people of a group with one diet and their intolerances, present from–to a meal. */
export interface Teilnehmende {
  id: number;
  etag: string;
  gruppeId: number;
  ernaehrung: Ernaehrung;
  anzahl: number;
  unvertraeglichkeiten: number[];
  /** null: from the first meal. */
  vonMahlzeitId: number | null;
  /** null: until the last meal. */
  bisMahlzeitId: number | null;
  hinweis: string;
}

/** A group factor as typed („0,7“) or sent (0.7); NaN for anything else. */
export function leseGruppenFaktor(value: unknown): number {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  const normal = text.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(normal) ? Number(normal) : Number.NaN;
}

export const GRUPPEN_FAKTOR_FEHLER = 'Bitte einen Faktor von 0,01 bis 5 eintragen, z. B. 0,7.';

/** As stored: `decimal(4, 2)` from 0.01 to 5. */
export function gruppenFaktorGueltig(faktor: number): boolean {
  return faktor >= 0.01 && faktor <= 5 && Math.abs(Math.round(faktor * 100) - faktor * 100) < 1e-6;
}

export interface GruppeInput {
  name: string;
  faktor: number;
}

export interface TeilnehmendeInput {
  gruppeId: number;
  ernaehrung: Ernaehrung;
  anzahl: number;
  unvertraeglichkeiten: number[];
  vonMahlzeitId: number | null;
  bisMahlzeitId: number | null;
  hinweis: string;
}

/** The meals of a Planung in their order (days by date, meals by position). */
export function mahlzeitenReihenfolge(
  tage: { mahlzeiten: { id: number }[] }[]
): Map<number, number> {
  return new Map(
    tage.flatMap((tag) => tag.mahlzeiten).map((mahlzeit, index) => [mahlzeit.id, index])
  );
}

/**
 * Whether a row of participants is there at a meal. A limit that is not in the plan any more
 * (a deleted meal without a following one) leaves nothing.
 */
export function anwesend(
  teilnehmende: Pick<Teilnehmende, 'vonMahlzeitId' | 'bisMahlzeitId'>,
  mahlzeitId: number,
  reihenfolge: Map<number, number>
): boolean {
  const hier = reihenfolge.get(mahlzeitId);
  if (hier === undefined) return false;
  const von = teilnehmende.vonMahlzeitId === null ? 0 : reihenfolge.get(teilnehmende.vonMahlzeitId);
  const bis =
    teilnehmende.bisMahlzeitId === null
      ? Number.POSITIVE_INFINITY
      : reihenfolge.get(teilnehmende.bisMahlzeitId);
  return von !== undefined && bis !== undefined && von <= hier && hier <= bis;
}

export interface Esser {
  /** People. */
  personen: number;
  /** People times the factor of their group. */
  gewichtet: number;
}

export interface EsserDerMahlzeit extends Esser {
  je: Record<Ernaehrung, Esser>;
}

/** Who eats at each meal: present, and their group is not left out there. */
export function esserJeMahlzeit(planung: {
  tage: { mahlzeiten: { id: number; ohneGruppen: number[] }[] }[];
  gruppen: Pick<PlanungGruppe, 'id' | 'faktor'>[];
  teilnehmende: Pick<
    Teilnehmende,
    'gruppeId' | 'ernaehrung' | 'anzahl' | 'vonMahlzeitId' | 'bisMahlzeitId'
  >[];
}): Map<number, EsserDerMahlzeit> {
  const reihenfolge = mahlzeitenReihenfolge(planung.tage);
  const faktor = new Map(planung.gruppen.map((gruppe) => [gruppe.id, gruppe.faktor]));
  const ergebnis = new Map<number, EsserDerMahlzeit>();
  for (const mahlzeit of planung.tage.flatMap((tag) => tag.mahlzeiten)) {
    const leer = (): Esser => ({ personen: 0, gewichtet: 0 });
    const esser: EsserDerMahlzeit = {
      ...leer(),
      je: { alles: leer(), vegetarisch: leer(), vegan: leer() },
    };
    for (const zeile of planung.teilnehmende) {
      if (mahlzeit.ohneGruppen.includes(zeile.gruppeId)) continue;
      if (!anwesend(zeile, mahlzeit.id, reihenfolge)) continue;
      const gewichtet = zeile.anzahl * (faktor.get(zeile.gruppeId) ?? 1);
      for (const ziel of [esser, esser.je[zeile.ernaehrung]]) {
        ziel.personen += zeile.anzahl;
        ziel.gewichtet += gewichtet;
      }
    }
    for (const ziel of [esser, ...Object.values(esser.je)])
      ziel.gewichtet = Math.round(ziel.gewichtet * 100) / 100;
    ergebnis.set(mahlzeit.id, esser);
  }
  return ergebnis;
}
