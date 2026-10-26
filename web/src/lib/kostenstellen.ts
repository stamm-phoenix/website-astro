import type {
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
): KategorieStatistik[] {
  return sortiere(
    kostenstelle.categories.map((kategorie) => ({ ...kategorie, name: kategorieName(kategorie) })),
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
    {
      incomeCent: 0,
      expensesCent: 0,
      balanceCent: 0,
      openIncomeCent: 0,
      openExpensesCent: 0,
      bookings: 0,
    }
  );
}

export function buchungen(anzahl: number): string {
  return `${anzahl.toLocaleString('de-DE')} ${anzahl === 1 ? 'Buchung' : 'Buchungen'}`;
}
