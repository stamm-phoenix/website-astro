import type { Gericht, PlanungMitglied, PlanungMahlzeit, PlanungTag } from './types';

/**
 * Helpers of the plan (`docs/essensplanung.md`, Einplanung): the rows of the calendar, a dish
 * by its typed name and who is responsible by a typed name. Without Svelte, so they are tested.
 */

/** A row of the calendar: meals of the same name on the days, in the order of the days. */
export interface KalenderZeile {
  /** The name in the column on the left, e.g. „Mittagessen“. */
  name: string;
  /** The meal of the row per day; missing where a day has no such meal. */
  mahlzeiten: Map<number, PlanungMahlzeit>;
}

const schluessel = (name: string): string => name.trim().toLocaleLowerCase('de');

/**
 * The rows of the calendar: every name of a meal once, in the order the days have them (a meal
 * only some days have sits between its neighbours of those days). A day with the same name
 * twice gets a second row. So an arrival day without breakfast leaves breakfast empty instead of
 * moving its dinner up into another row.
 */
export function kalenderZeilen(tage: Pick<PlanungTag, 'id' | 'mahlzeiten'>[]): KalenderZeile[] {
  const zeilen: (KalenderZeile & { key: string })[] = [];
  for (const tag of tage) {
    /** The index of the row the previous meal of this day went to. */
    let vorher = -1;
    const gezaehlt = new Map<string, number>();
    for (const mahlzeit of tag.mahlzeiten) {
      const name = schluessel(mahlzeit.name);
      const nummer = (gezaehlt.get(name) ?? 0) + 1;
      gezaehlt.set(name, nummer);
      const key = `${name}\u0000${nummer}`;
      let index = zeilen.findIndex((zeile) => zeile.key === key);
      // A row that sits above where this day already is would cross: then a new one
      if (index >= 0 && index <= vorher) index = -1;
      if (index < 0) {
        index = vorher + 1;
        zeilen.splice(index, 0, { key, name: mahlzeit.name, mahlzeiten: new Map() });
      }
      zeilen[index].mahlzeiten.set(tag.id, mahlzeit);
      vorher = index;
    }
  }
  return zeilen.map(({ name, mahlzeiten }) => ({ name, mahlzeiten }));
}

/** The dish of a planning with this name, ignoring case and spaces at the ends. */
export function gerichtNamens(
  gerichte: Pick<Gericht, 'id' | 'name'>[],
  name: string
): Pick<Gericht, 'id' | 'name'> | undefined {
  const gesucht = schluessel(name);
  return gerichte.find((gericht) => schluessel(gericht.name) === gesucht);
}

/**
 * Who is responsible for a typed name: a member with access of that name, else the name as
 * free text; empty is nobody.
 */
export function zustaendigAus(
  text: string,
  mitglieder: Pick<PlanungMitglied, 'id' | 'name' | 'entzogen'>[]
): { zustaendigId: number | null; zustaendigText: string } {
  const name = text.trim().replace(/\s+/g, ' ');
  const mitglied = name
    ? mitglieder.find((m) => !m.entzogen && schluessel(m.name) === schluessel(name))
    : undefined;
  return mitglied
    ? { zustaendigId: mitglied.id, zustaendigText: '' }
    : { zustaendigId: null, zustaendigText: name };
}

/** Whether a name fits a search, ignoring case; every word must be part of it. */
export function passtZurSuche(name: string, suche: string): boolean {
  const text = schluessel(name);
  return schluessel(suche)
    .split(/\s+/)
    .filter(Boolean)
    .every((wort) => text.includes(wort));
}

/**
 * The position (1-based) a dish dropped at `index` gets in its meal: moving within the meal
 * counts without its old place.
 */
export function zielPosition(
  einplanungen: { id: number }[],
  index: number,
  einplanungId: number | null
): number {
  const alt = einplanungId === null ? -1 : einplanungen.findIndex((e) => e.id === einplanungId);
  return (alt >= 0 && alt < index ? index - 1 : index) + 1;
}

/** Where a planned dish moves with the keyboard (Alt and an arrow key). */
export type Richtung = 'hoch' | 'runter' | 'links' | 'rechts';

/**
 * The place next to a planned dish in `richtung`: up and down within its meal and then into the
 * meal before or after on the same day, left and right into the same meal of the previous or
 * next day that has one. `position` is 1-based in the target meal. null at the edge.
 */
export function nachbarPlatz(
  tage: Pick<PlanungTag, 'id' | 'mahlzeiten'>[],
  mahlzeitId: number,
  einplanungId: number,
  richtung: Richtung
): { mahlzeit: PlanungMahlzeit; position: number } | null {
  const tagIndex = tage.findIndex((tag) => tag.mahlzeiten.some((m) => m.id === mahlzeitId));
  if (tagIndex < 0) return null;
  const tag = tage[tagIndex];
  const slot = tag.mahlzeiten.findIndex((m) => m.id === mahlzeitId);
  const mahlzeit = tag.mahlzeiten[slot];
  const index = mahlzeit.einplanungen.findIndex((e) => e.id === einplanungId);
  if (richtung === 'hoch') {
    if (index > 0) return { mahlzeit, position: index };
    const vorher = tag.mahlzeiten[slot - 1];
    return vorher ? { mahlzeit: vorher, position: vorher.einplanungen.length + 1 } : null;
  }
  if (richtung === 'runter') {
    if (index < mahlzeit.einplanungen.length - 1) return { mahlzeit, position: index + 2 };
    const danach = tag.mahlzeiten[slot + 1];
    return danach ? { mahlzeit: danach, position: 1 } : null;
  }
  const zeile = kalenderZeilen(tage).find((z) => z.mahlzeiten.get(tag.id)?.id === mahlzeitId);
  const schritt = richtung === 'links' ? -1 : 1;
  for (let i = tagIndex + schritt; i >= 0 && i < tage.length; i += schritt) {
    const ziel = zeile?.mahlzeiten.get(tage[i].id);
    if (ziel)
      return { mahlzeit: ziel, position: Math.min(index + 1, ziel.einplanungen.length + 1) };
  }
  return null;
}
