import type {
  JahresSummen,
  KategorieStatistik,
  KostenstelleStatistik,
  KostenstellenSphaere,
  KostenstellenSummen,
} from './types';

export type KostenstellenAnsicht = 'aktuell' | 'archiviert' | 'alle';
export type KostenstellenSortierung = 'name' | 'saldo' | 'ausgaben' | 'einnahmen';

export const SORTIERUNGEN: readonly { value: KostenstellenSortierung; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'ausgaben', label: 'Höchste Ausgaben' },
  { value: 'einnahmen', label: 'Höchste Einnahmen' },
  { value: 'saldo', label: 'Niedrigster Saldo' },
];

export const SPHAEREN: Record<KostenstellenSphaere, string> = {
  ideal: 'Ideeller Bereich',
  purpose: 'Zweckbetrieb',
  assets: 'Vermögensverwaltung',
  business: 'Wirtschaftlicher Geschäftsbetrieb',
};

/** Name of a Kategorie on screen; bookings without one are grouped under „Ohne Kategorie“. */
export function kategorieName(kategorie: Pick<KategorieStatistik, 'name'>): string {
  return kategorie.name || 'Ohne Kategorie';
}

export function inAnsicht(
  kostenstelle: KostenstelleStatistik,
  ansicht: KostenstellenAnsicht
): boolean {
  if (ansicht === 'alle') return true;
  return ansicht === 'archiviert' ? kostenstelle.archived : !kostenstelle.archived;
}

/** Whether the Kostenstelle has a booking in the year; `null` means every year. */
export function imJahr(kostenstelle: KostenstelleStatistik, jahr: number | null): boolean {
  return jahr === null || kostenstelle.years.includes(jahr);
}

const KEINE_SUMMEN: KostenstellenSummen = {
  incomeCent: 0,
  expensesCent: 0,
  balanceCent: 0,
  openIncomeCent: 0,
  openExpensesCent: 0,
  bookings: 0,
};

/** The sums of a Kostenstelle or Kategorie in the year, or over the whole period for `null`. */
export function summenImJahr(
  eintrag: KostenstellenSummen & { yearTotals: JahresSummen[] },
  jahr: number | null
): KostenstellenSummen {
  if (jahr === null) return eintrag;
  const summen = eintrag.yearTotals.find((s) => s.year === jahr) ?? KEINE_SUMMEN;
  return {
    incomeCent: summen.incomeCent,
    expensesCent: summen.expensesCent,
    balanceCent: summen.balanceCent,
    openIncomeCent: summen.openIncomeCent,
    openExpensesCent: summen.openExpensesCent,
    bookings: summen.bookings,
  };
}

/**
 * The Kostenstelle as the view shows it for the year: its sums and those of every Kategorie
 * (also one without bookings that year) only from that year; unchanged for `null`.
 */
export function imJahrGesehen(
  kostenstelle: KostenstelleStatistik,
  jahr: number | null
): KostenstelleStatistik {
  if (jahr === null) return kostenstelle;
  return {
    ...kostenstelle,
    ...summenImJahr(kostenstelle, jahr),
    categories: kostenstelle.categories.map((kategorie) => ({
      ...kategorie,
      ...summenImJahr(kategorie, jahr),
    })),
  };
}

/** The years with bookings of any Kostenstelle, newest first. */
export function jahre(kostenstellen: readonly KostenstelleStatistik[]): number[] {
  return [...new Set(kostenstellen.flatMap((k) => k.years))].sort((a, b) => b - a);
}

/** The empty state when no Kostenstelle of the view has a booking in the year. */
export function keineImJahr(ansicht: KostenstellenAnsicht, jahr: number): string {
  const art = { aktuell: 'aktuelle ', archiviert: 'archivierte ', alle: '' }[ansicht];
  return `Keine ${art}Kostenstelle hat Buchungen aus ${jahr}.`;
}

const normalize = (value: string): string => value.toLocaleLowerCase('de').trim();

/** Whether the search matches the Kostenstelle, and whether only through a Kategorie. */
export function treffer(
  kostenstelle: KostenstelleStatistik,
  suche: string
): 'name' | 'kategorie' | null {
  const query = normalize(suche);
  if (!query || normalize(kostenstelle.name).includes(query)) return 'name';
  return kostenstelle.categories.some((kategorie) =>
    normalize(kategorieName(kategorie)).includes(query)
  )
    ? 'kategorie'
    : null;
}

/** Sorts a copy; ties and the default go by name. */
export function sortiere<T extends KostenstellenSummen & { name: string }>(
  eintraege: readonly T[],
  sortierung: KostenstellenSortierung
): T[] {
  const byName = (a: T, b: T): number => a.name.localeCompare(b.name, 'de');
  const key: Record<KostenstellenSortierung, (a: T, b: T) => number> = {
    name: () => 0,
    ausgaben: (a, b) => a.expensesCent - b.expensesCent,
    einnahmen: (a, b) => b.incomeCent - a.incomeCent,
    saldo: (a, b) => a.balanceCent - b.balanceCent,
  };
  return [...eintraege].sort((a, b) => key[sortierung](a, b) || byName(a, b));
}

/** The Kategorien of a Kostenstelle with their names on screen, sorted like the Kostenstellen. */
export function kategorien(
  kostenstelle: KostenstelleStatistik,
  sortierung: KostenstellenSortierung
): (KategorieStatistik & { key: string })[] {
  return sortiere(
    kostenstelle.categories.map((kategorie) => ({
      ...kategorie,
      // From the name CampFlow reports, before „Ohne Kategorie“ replaces an empty one
      key: kategorie.id ?? `name:${kategorie.name}`,
      name: kategorieName(kategorie),
    })),
    sortierung
  );
}

/** The sums of several Kostenstellen together. */
export function gesamt(eintraege: readonly KostenstellenSummen[]): KostenstellenSummen {
  return eintraege.reduce<KostenstellenSummen>(
    (sum, eintrag) => ({
      incomeCent: sum.incomeCent + eintrag.incomeCent,
      expensesCent: sum.expensesCent + eintrag.expensesCent,
      balanceCent: sum.balanceCent + eintrag.balanceCent,
      openIncomeCent: sum.openIncomeCent + eintrag.openIncomeCent,
      openExpensesCent: sum.openExpensesCent + eintrag.openExpensesCent,
      bookings: sum.bookings + eintrag.bookings,
    }),
    KEINE_SUMMEN
  );
}

export function buchungen(anzahl: number): string {
  return `${anzahl.toLocaleString('de-DE')} ${anzahl === 1 ? 'Buchung' : 'Buchungen'}`;
}
