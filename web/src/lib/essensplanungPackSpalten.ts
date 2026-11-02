import { personKey, type PackZeile } from './essensplanungPackliste';
import type { PackZuteilung, PlanungMitglied } from './types';

/**
 * The columns of the packing list as a matrix (`docs/essensplanung.md`, Packliste): the persons
 * across, the things down. A column is a member or a free name some row has; the cell of a
 * person who packs the thing is their own box.
 */

/** One person of the matrix. */
export interface PackSpalte {
  /** `m:<id>` for a member, `t:<merged name>` for a free name (`personKey`). */
  key: string;
  name: string;
  /** What a click in an empty cell adds: this member, or the free name `name`. */
  mitgliedId: number | null;
  ich: boolean;
  /**
   * A member without access: removed, or missing from the view (those who do not manage the
   * members do not get removed ones). They keep what they pack, but get nothing new.
   */
  ohneZugang: boolean;
}

const VERGLEICH = new Intl.Collator('de');

/** The share of a column's person in a row, if they pack it. */
export function anteil(zeile: Pick<PackZeile, 'personen'>, key: string): PackZuteilung | undefined {
  return zeile.personen.find((person) => personKey(person) === key);
}

/**
 * The columns: the members with access in the order of the view (one without access only while
 * they pack something), then the free names of the rows by name.
 */
export function packSpalten(
  mitglieder: Pick<PlanungMitglied, 'id' | 'name' | 'entzogen' | 'ich'>[],
  zeilen: Pick<PackZeile, 'personen'>[]
): PackSpalte[] {
  const personen = zeilen.flatMap((zeile) => zeile.personen);
  const spalten: PackSpalte[] = mitglieder
    .filter((m) => !m.entzogen || personen.some((p) => p.mitgliedId === m.id))
    .map((m) => ({
      key: `m:${m.id}`,
      name: m.name,
      mitgliedId: m.id,
      ich: m.ich,
      ohneZugang: m.entzogen,
    }));
  const vorhanden = new Set(spalten.map((s) => s.key));
  const frei = new Map<string, PackSpalte>();
  for (const person of personen) {
    const key = personKey(person);
    if (vorhanden.has(key) || frei.has(key)) continue;
    if (person.mitgliedId !== null) {
      // A member the view lacks, e.g. one without access for those who only read
      vorhanden.add(key);
      spalten.push({
        key,
        name: person.name || 'Mitglied ohne Zugang',
        mitgliedId: person.mitgliedId,
        ich: false,
        ohneZugang: true,
      });
    } else {
      frei.set(key, { key, name: person.name, mitgliedId: null, ich: false, ohneZugang: false });
    }
  }
  return [...spalten, ...[...frei.values()].sort((a, b) => VERGLEICH.compare(a.name, b.name))];
}

/** How many things a column's person packs and how many of them they packed. */
export function spaltenSumme(
  zeilen: Pick<PackZeile, 'personen'>[],
  key: string
): { gepackt: number; gesamt: number } {
  const eigene = zeilen.flatMap((zeile) => anteil(zeile, key) ?? []);
  return { gepackt: eigene.filter((person) => person.gepackt).length, gesamt: eigene.length };
}
