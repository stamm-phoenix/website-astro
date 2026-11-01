import { formatIsoDate } from './belege';
import type { PlanungBeleg, PlanungMitglied } from './types';

/**
 * The receipts of a Planung (`docs/essensplanung.md`, Belege) as the page and the PDF show them:
 * the filter, who paid how much and what is still to pay back, and the rows of the PDF. Without
 * jsPDF, so it can be tested.
 */

export type BelegFilter = 'alle' | 'offen' | 'erstattet';

export function gefilterteBelege(belege: PlanungBeleg[], filter: BelegFilter): PlanungBeleg[] {
  if (filter === 'offen') return belege.filter((beleg) => !beleg.erstattet);
  if (filter === 'erstattet') return belege.filter((beleg) => beleg.erstattet);
  return belege;
}

const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** „12,34 €“. */
export function euro(cent: number): string {
  return EURO.format(cent / 100);
}

/** One person who paid: by member, or by the free name written alike. */
export interface BelegPerson {
  key: string;
  name: string;
  anzahl: number;
  /** All receipts the person paid. */
  gesamtCent: number;
  /** Of these, what is not paid back yet. */
  offenCent: number;
}

export interface BelegStatistik {
  personen: BelegPerson[];
  anzahl: number;
  gesamtCent: number;
  offenCent: number;
  erstattetCent: number;
}

/** Members by id, free names without case and extra spaces, so „Oma Inge“ is one person. */
export function personKey(beleg: Pick<PlanungBeleg, 'bezahltVonId' | 'bezahltVonText'>): string {
  return beleg.bezahltVonId !== null
    ? `m${beleg.bezahltVonId}`
    : `t${beleg.bezahltVonText.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE')}`;
}

/**
 * Who paid how much and what each still gets back. Receipts marked as paid back count in the
 * totals only. Sorted by what is still open, then by name.
 */
export function belegStatistik(belege: PlanungBeleg[]): BelegStatistik {
  const personen = new Map<string, BelegPerson>();
  let gesamtCent = 0;
  let offenCent = 0;
  for (const beleg of belege) {
    const key = personKey(beleg);
    const person = personen.get(key) ?? {
      key,
      name: beleg.bezahltVon || 'Unbekannt',
      anzahl: 0,
      gesamtCent: 0,
      offenCent: 0,
    };
    person.anzahl++;
    person.gesamtCent += beleg.betragCent;
    gesamtCent += beleg.betragCent;
    if (!beleg.erstattet) {
      person.offenCent += beleg.betragCent;
      offenCent += beleg.betragCent;
    }
    personen.set(key, person);
  }
  return {
    personen: [...personen.values()].sort(
      (a, b) => b.offenCent - a.offenCent || a.name.localeCompare(b.name, 'de')
    ),
    anzahl: belege.length,
    gesamtCent,
    offenCent,
    erstattetCent: gesamtCent - offenCent,
  };
}

/** Members who can be chosen as payer; one without access only while they paid this one. */
export function bezahltVonWahl(
  mitglieder: PlanungMitglied[],
  bisher: number | null = null,
  bisherName = ''
): PlanungMitglied[] {
  const wahl = mitglieder.filter((mitglied) => !mitglied.entzogen || mitglied.id === bisher);
  // Without managing members, a member without access is missing from the view: the one who
  // paid this receipt stays choosable under the name the receipt gives
  if (bisher !== null && !wahl.some((mitglied) => mitglied.id === bisher)) {
    wahl.push({
      id: bisher,
      etag: '',
      name: bisherName || 'Mitglied',
      rolle: 'bearbeiten',
      email: null,
      entzogen: true,
      ich: false,
    });
  }
  return wahl;
}

/** A row of the table of the PDF. */
export interface BelegDruckZeile {
  datum: string;
  haendler: string;
  notiz: string;
  bezahltVon: string;
  betrag: string;
  status: string;
}

export function belegDruckZeile(beleg: PlanungBeleg): BelegDruckZeile {
  return {
    datum: formatIsoDate(beleg.datum),
    haendler: beleg.haendler || '–',
    notiz: beleg.notiz,
    bezahltVon: beleg.bezahltVon,
    betrag: euro(beleg.betragCent),
    status: beleg.erstattet ? 'erstattet' : 'offen',
  };
}

/** The rows of the statistics in the PDF, with the sum at the end. */
export function statistikDruck(statistik: BelegStatistik): string[][] {
  return [
    ...statistik.personen.map((person) => [
      person.name,
      String(person.anzahl),
      euro(person.gesamtCent),
      euro(person.offenCent),
    ]),
    ['Summe', String(statistik.anzahl), euro(statistik.gesamtCent), euro(statistik.offenCent)],
  ];
}

/** Title of a receipt's photo page, e.g. „01.10.2026 · Rewe · 42,50 € · Kim“. */
export function belegTitel(beleg: PlanungBeleg): string {
  return [formatIsoDate(beleg.datum), beleg.haendler, euro(beleg.betragCent), beleg.bezahltVon]
    .filter(Boolean)
    .join(' · ');
}
