import type { Vorschlag } from './vorschlaege';

/**
 * Where a receipt is booked in CampFlow: a Kostenstelle and one of its Kategorien, both by name.
 * Either may be typed in; the transfer creates whatever CampFlow lacks (docs/belege-campflow.md).
 */

/** The Kategorien of the KJR, always offered, also where a Kostenstelle lacks them so far. */
export const STANDARD_KATEGORIEN = [
  'Fahrtkosten',
  'Verpflegungskosten',
  'Miet- und Übernachtungskosten',
  'Honorare',
  'Arbeits- und Hilfsmittel',
] as const;

interface Unit {
  id: string;
  name: string;
  archived: boolean;
  categories: { id: string; name: string }[];
}

const fold = (text: string): string => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
export const sameName = (a: string, b: string): boolean => fold(a) === fold(b);

export function isStandardKategorie(name: string): boolean {
  return STANDARD_KATEGORIEN.some((standard) => sameName(standard, name));
}

/** The Kostenstelle of that name, an archived one only if no other has it, as the API picks it. */
export function findKostenstelle<T extends Unit>(units: readonly T[], name: string): T | undefined {
  if (!name.trim()) return undefined;
  const matches = units.filter((unit) => sameName(unit.name, name));
  return matches.find((unit) => !unit.archived) ?? matches[0];
}

/** Value of a suggestion of the search: which Kostenstelle, and which Kategorie if any. */
export interface ZuordnungTreffer {
  kostenstelle: string;
  kategorie: string | null;
}

/**
 * Suggestions of the search across all Kostenstellen and Kategorien: the Kostenstellen first,
 * then the Kategorien under the name of their Kostenstelle. A Kategorie matches by its own name,
 * so „leite“ finds „Leitendenrunde“ in „Allgemein“ without every Kategorie of „Leitendenlager“.
 */
export function zuordnungVorschlaege(units: readonly Unit[]): Vorschlag[] {
  const active = units.filter((unit) => !unit.archived);
  return [
    ...active.map((unit) => ({
      value: JSON.stringify({ kostenstelle: unit.name, kategorie: null }),
      label: unit.name,
      gruppe: 'Kostenstellen',
      key: unit.id,
    })),
    ...active.flatMap((unit) =>
      unit.categories.map((category) => ({
        value: JSON.stringify({ kostenstelle: unit.name, kategorie: category.name }),
        label: category.name,
        gruppe: `Kategorie in ${unit.name}`,
        key: category.id,
      }))
    ),
  ];
}

export function readZuordnungTreffer(value: string): ZuordnungTreffer {
  return JSON.parse(value) as ZuordnungTreffer;
}

/** Kategorien to pick for a Kostenstelle: the standard ones first, then its own others. */
export function kategorieVorschlaege(units: readonly Unit[], kostenstelle: string): Vorschlag[] {
  const own = findKostenstelle(units, kostenstelle)?.categories ?? [];
  return [
    ...STANDARD_KATEGORIEN.map((name) => ({ value: name, gruppe: 'Standard' })),
    ...own
      .filter((category) => !isStandardKategorie(category.name))
      .map((category) => ({ value: category.name, gruppe: 'Weitere in dieser Kostenstelle' })),
  ];
}

export function kostenstelleVorschlaege(units: readonly Unit[]): Vorschlag[] {
  return units.filter((unit) => !unit.archived).map((unit) => ({ value: unit.name, key: unit.id }));
}

/** What booking on the chosen names means in CampFlow; `null` while the list is unknown. */
export interface ZuordnungStand {
  /** Neither the Kostenstelle nor one of that name exists: it is created on transfer. */
  neueKostenstelle: boolean;
  /** Only an archived Kostenstelle has that name; CampFlow refuses to book on it. */
  archiviert: boolean;
  /** The Kostenstelle lacks the Kategorie and it is none of the standard ones. */
  neueKategorie: boolean;
  /** The Kostenstelle lacks this standard Kategorie: created on transfer without a warning. */
  neueStandardKategorie: boolean;
}

export function zuordnungStand(
  units: readonly Unit[] | null,
  kostenstelle: string,
  kategorie: string
): ZuordnungStand | null {
  if (!units || !kostenstelle.trim()) return null;
  const unit = findKostenstelle(units, kostenstelle);
  const has = !!kategorie.trim() && !!unit?.categories.some((c) => sameName(c.name, kategorie));
  const missing = !!kategorie.trim() && !has;
  return {
    neueKostenstelle: !unit,
    archiviert: !!unit?.archived,
    neueKategorie: missing && !isStandardKategorie(kategorie),
    neueStandardKategorie: missing && isStandardKategorie(kategorie),
  };
}
