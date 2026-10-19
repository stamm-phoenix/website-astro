import type { StatusTone } from './status';
import type { Beitrag, BeitragSammlung } from './types';
import { formatEuro } from './format';

/** Status filters of the list, like CampFlow's quick filters. */
export type BeitragFilter = 'alle' | 'offen' | 'bezahlt' | 'erstatten' | 'storniert';

const IN_FILTER: Record<Exclude<BeitragFilter, 'alle'>, readonly Beitrag['status'][]> = {
  offen: ['unpaid', 'partial'],
  bezahlt: ['paid'],
  erstatten: ['refund'],
  storniert: ['cancelled'],
};

export function matchesFilter(fee: Beitrag, filter: BeitragFilter): boolean {
  return filter === 'alle' || IN_FILTER[filter].includes(fee.status);
}

/** The status in words, as the list shows it next to the amount. */
export function statusLabel(fee: Beitrag): { label: string; tone: StatusTone } {
  switch (fee.status) {
    case 'paid':
      return { label: 'Bezahlt', tone: 'success' };
    case 'partial':
      return { label: `Teilweise bezahlt, ${formatEuro(fee.openCent)} offen`, tone: 'warning' };
    case 'refund':
      return { label: `${formatEuro(-fee.openCent)} zu viel bezahlt`, tone: 'warning' };
    case 'cancelled':
      return { label: 'Storniert', tone: 'neutral' };
    default:
      return { label: 'Nicht bezahlt', tone: 'warning' };
  }
}

/** Searches name, description, Kostenstelle and Verwendungszweck, ignoring case. */
export function matchesSearch(fee: Beitrag, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    fee.payer,
    fee.description,
    fee.reference,
    fee.costUnit?.name ?? '',
    fee.category ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export interface BeitragSummen {
  dueCent: number;
  paidCent: number;
  openCent: number;
  refundCent: number;
}

/** Sums of the shown Beiträge; what was paid too much counts apart from what is still open. */
export function summen(fees: readonly Beitrag[]): BeitragSummen {
  const sums = { dueCent: 0, paidCent: 0, openCent: 0, refundCent: 0 };
  for (const fee of fees) {
    sums.dueCent += fee.dueCent;
    sums.paidCent += fee.paidCent;
    if (fee.openCent > 0) sums.openCent += fee.openCent;
    else sums.refundCent -= fee.openCent;
  }
  return sums;
}

/** Whether nothing is left to do for the Sammlung: nothing open, nothing to pay back. */
export function isErledigt(batch: BeitragSammlung): boolean {
  return batch.openCent === 0 && batch.refundCent === 0;
}

/** How many Beiträge of a Sammlung are paid, and how many were cancelled and so not due. */
export interface SammlungZahlen {
  paid: number;
  cancelled: number;
  /** Not cancelled, so to be paid. */
  due: number;
}

/**
 * Counts the Sammlung's Beiträge. CampFlow's own count („11 bezahlt“) includes cancelled ones, so
 * the overview counts from the Beiträge instead. Paid too much counts as paid.
 */
export function sammlungZahlen(fees: readonly Beitrag[]): SammlungZahlen {
  const cancelled = fees.filter((fee) => fee.status === 'cancelled').length;
  const paid = fees.filter((fee) => fee.status === 'paid' || fee.status === 'refund').length;
  return { paid, cancelled, due: fees.length - cancelled };
}

/** „7 von 11 bezahlt · 1 storniert · 150,00 € offen“, as the overview lists a Sammlung. */
export function sammlungStand(batch: BeitragSammlung, zahlen: SammlungZahlen): string {
  const { paid, cancelled, due } = zahlen;
  const parts =
    due === 0
      ? [cancelled === 1 ? 'Storniert' : 'Alle storniert']
      : [paid >= due ? (due === 1 ? 'Bezahlt' : 'Alle bezahlt') : `${paid} von ${due} bezahlt`];
  if (due > 0 && cancelled > 0) parts.push(`${cancelled} storniert`);
  if (batch.openCent > 0) parts.push(`${formatEuro(batch.openCent)} offen`);
  if (batch.refundCent > 0) parts.push(`${formatEuro(batch.refundCent)} zu erstatten`);
  return parts.join(' · ');
}

/** Kostenstellen of the Beiträge, each once and sorted by name. */
export function kostenstellen(fees: readonly Beitrag[]): { id: string; name: string }[] {
  const byId = new Map<string, string>();
  for (const fee of fees) if (fee.costUnit) byId.set(fee.costUnit.id, fee.costUnit.name);
  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
