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

/** A standard Kategorie in its own spelling, any other name as typed. */
export function kategorieSchreibweise(name: string): string {
  return STANDARD_KATEGORIEN.find((standard) => sameName(standard, name)) ?? name;
}

/** The Kostenstelle of that name, an archived one only if no other has it, as the API picks it. */
export function findKostenstelle<T extends Unit>(units: readonly T[], name: string): T | undefined {
  if (!name.trim()) return undefined;
  const matches = units.filter((unit) => sameName(unit.name, name));
  return matches.find((unit) => !unit.archived) ?? matches[0];
}

/** What a suggestion of the field Kostenstelle fills in: the Kostenstelle, and a Kategorie. */
export interface ZuordnungTreffer {
  kostenstelle: string;
  kategorie: string | null;
}

/**
 * Suggestions of the field Kostenstelle, which also searches the Kategorien: the Kostenstellen
 * first, then the Kategorien under the name of their Kostenstelle. Every word typed must appear,
 * and a Kategorie needs one of them in its own name: „leite“ finds „Leitendenrunde“ in
 * „Allgemein“ without every Kategorie of „Leitendenlager“, and „verpflegung stammes“ narrows the
 * many „Verpflegung“ to those of the Kostenstellen named so. Each suggestion's value is the
 * Kostenstelle it fills in; the suggestions already match `query`, so the field keeps them all.
 */
export function zuordnungVorschlaege(units: readonly Unit[], query = ''): Vorschlag[] {
  const words = fold(query).split(' ').filter(Boolean);
  const has = (text: string, word: string): boolean => fold(text).includes(word);
  const active = units.filter((unit) => !unit.archived);
  const search = query || undefined;
  return [
    ...active
      .filter((unit) => words.every((word) => has(unit.name, word)))
      .map((unit) => ({ value: unit.name, search, gruppe: 'Kostenstellen', key: unit.id })),
    ...active.flatMap((unit) =>
      unit.categories
        .filter(
          (category) =>
            words.every((word) => has(`${category.name} ${unit.name}`, word)) &&
            (!words.length || words.some((word) => has(category.name, word)))
        )
        .map((category) => ({
          value: unit.name,
          label: category.name,
          search,
          gruppe: `Kategorie in ${unit.name}`,
          key: category.id,
        }))
    ),
  ];
}

/** What the picked suggestion fills in, found by its key (the ID in CampFlow). */
export function zuordnungTreffer(units: readonly Unit[], option: Vorschlag): ZuordnungTreffer {
  for (const unit of units) {
    if (unit.id === option.key) return { kostenstelle: unit.name, kategorie: null };
    const category = unit.categories.find((c) => c.id === option.key);
    if (category) return { kostenstelle: unit.name, kategorie: category.name };
  }
  return { kostenstelle: option.value, kategorie: null };
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
