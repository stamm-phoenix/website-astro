import { formatIsoDate } from './belege';
import { formatEuro } from './format';
import { SPARBUCH } from './belegForm';
import type { BelegArt } from './types';

/** What a receipt shows when it is looked at, from a stored receipt or the open form. */
export interface BelegDetailQuelle {
  art: BelegArt;
  date: string;
  amountCent: number | null;
  kostenstelle: string;
  kategorie: string;
  aktion: string;
  payout: boolean | null;
  paidBy: string;
  note: string;
  submittedBy: string;
  submittedByName?: string;
}

/** How a receipt was paid, in the words of the form. */
export function bezahltText(beleg: Pick<BelegDetailQuelle, 'payout' | 'paidBy'>): string {
  if (!beleg.payout) return 'Mit Stammeskarte / aus der Kasse';
  if (beleg.paidBy.trim() === SPARBUCH) return 'Umbuchung aufs Sparbuch';
  return beleg.paidBy.trim() ? `Privat ausgelegt von ${beleg.paidBy.trim()}` : 'Privat ausgelegt';
}

/** Who submitted a receipt: the name the server knows, else the login. */
export function eingereichtVon(
  beleg: Pick<BelegDetailQuelle, 'submittedBy' | 'submittedByName'>
): string {
  return beleg.submittedByName || beleg.submittedBy;
}

/** Label and value of each filled detail, in the order of the form. */
export function belegDetails(beleg: BelegDetailQuelle): [string, string][] {
  const einnahme = beleg.art === 'Einnahme';
  const rows: [string, string | null][] = [
    ['Art', einnahme ? 'Einnahme' : 'Ausgabe'],
    ['Datum', beleg.date ? formatIsoDate(beleg.date) : null],
    ['Betrag', beleg.amountCent === null ? null : formatEuro(beleg.amountCent)],
    ['Kostenstelle', beleg.kostenstelle || null],
    ['Kategorie', beleg.kategorie || null],
    // Older receipts name an Aktion instead
    ['Aktion', beleg.kostenstelle ? null : beleg.aktion || null],
    ['Bezahlt', einnahme ? null : bezahltText(beleg)],
    ['Bemerkung', beleg.note || null],
    ['Eingereicht von', eingereichtVon(beleg) || null],
  ];
  return rows.filter((row): row is [string, string] => !!row[1]);
}
