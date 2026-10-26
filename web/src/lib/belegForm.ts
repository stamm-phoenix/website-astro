import { parseEuroToCent } from './belege';
import { todayIso, formatDateTime } from './format';
import type { BelegCampflow, BelegCheck, BelegStatus } from './types';
export interface BelegForm {
  id: string | null;
  etag: string;
  shop: string;
  date: string;
  amount: string;
  /** Who gets the Auslage back; empty when the Stamm paid. */
  paidBy: string;
  payout: boolean | null;
  /** How it was paid, as chosen in the form; sets `paidBy` and `payout`. */
  zahlung: BelegZahlung | null;
  /** Older receipts only; it is shown, not edited. */
  aktion: string;
  kostenstelle: string;
  kategorie: string;
  note: string;
  status: BelegStatus;
  reviewNote: string;
  hasImage: boolean;
  hasOriginal: boolean;
  submittedBy: string;
  submittedAt: string;
  aiCheck: BelegCheck | null;
  campflow: BelegCampflow | null;
}

/**
 * How a receipt was paid: out of the own pocket, by someone else, by the Stamm (card or cash box)
 * or as a transfer to the savings book. All but the Stamm are an Auslage in CampFlow.
 */
export type BelegZahlung = 'ich' | 'andere' | 'stamm' | 'sparbuch';

/** What CampFlow's „Auslage durch“ says for a transfer to the savings book. */
export const SPARBUCH = 'Sparbuch';

/** The choice in the form for a stored receipt; `isIch` tells the own Auslage from others. */
export function zahlungOf(
  beleg: { payout: boolean; paidBy: string },
  isIch: (person: { name: string }) => boolean
): BelegZahlung {
  if (!beleg.payout) return 'stamm';
  if (beleg.paidBy.trim() === SPARBUCH) return 'sparbuch';
  return isIch({ name: beleg.paidBy }) ? 'ich' : 'andere';
}

/** Sets who gets the Auslage for a choice; `myName` for the own one. */
export function applyZahlung(form: BelegForm, zahlung: BelegZahlung, myName: string): void {
  const before = form.zahlung;
  form.zahlung = zahlung;
  form.payout = zahlung !== 'stamm';
  if (zahlung === 'ich') form.paidBy = myName;
  else if (zahlung === 'sparbuch') form.paidBy = SPARBUCH;
  else if (zahlung === 'stamm') form.paidBy = '';
  // Someone else: a name typed before stays, the own name or „Sparbuch“ does not
  else if (before !== 'andere') form.paidBy = '';
}

export function photoUrl(beleg: { id: string | null; etag: string }, variant = ''): string {
  return `/api/intern/pflege/belege/${beleg.id}/foto?v=${encodeURIComponent(beleg.etag)}${variant}`;
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : formatDateTime(date);
}
export function validateBeleg(
  f: BelegForm,
  hasPhoto: boolean,
  forTransfer = false
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!f.id && !hasPhoto) result.photo = 'Bitte ein Foto des Belegs hinzufügen.';
  if (!f.shop.trim()) result.shop = 'Bitte das Geschäft angeben.';
  if (!f.date) result.date = 'Bitte das Datum angeben.';
  else if (f.date > todayIso()) result.date = 'Das Datum liegt in der Zukunft.';
  if (parseEuroToCent(f.amount) === null)
    result.amountCent = 'Bitte einen Betrag wie 12,34 angeben.';
  if (f.zahlung === null) result.payout = 'Bitte auswählen, wie bezahlt wurde.';
  else if (f.zahlung === 'andere' && !f.paidBy.trim()) {
    result.paidBy = 'Bitte angeben, wer das Geld ausgelegt hat.';
  } else if (f.zahlung === 'ich' && !f.paidBy.trim()) {
    result.payout = 'Dein Name ist nicht bekannt. Wähle „Jemand anderes“ und trage ihn ein.';
  }
  // A receipt from before Kostenstelle and Kategorie may keep its Aktion, unless it is transferred
  if (!f.aktion.trim() || f.kostenstelle.trim() || f.kategorie.trim() || forTransfer) {
    if (!f.kostenstelle.trim()) result.kostenstelle = 'Bitte die Kostenstelle angeben.';
    if (!f.kategorie.trim()) result.kategorie = 'Bitte die Kategorie angeben.';
  }
  if (f.status === 'Abgelehnt' && !f.reviewNote.trim()) {
    result.reviewNote = 'Bitte begründen, warum der Beleg abgelehnt wird.';
  }
  return result;
}

export function decisionMessage(
  shop: string,
  decision: BelegStatus | undefined,
  mailed: boolean,
  submittedBy: string
): string {
  switch (decision) {
    case 'Angenommen':
      return `Beleg von ${shop} angenommen. Jetzt Kostenstelle und Kategorie prüfen und nach CampFlow übertragen.`;
    case 'Abgelehnt':
      return mailed
        ? `Beleg von ${shop} abgelehnt. ${submittedBy} hat die Begründung per Mail bekommen.`
        : `Beleg von ${shop} abgelehnt. Es wurde keine Mail verschickt, bitte gib ${submittedBy || 'der Person'} selbst Bescheid.`;
    case 'Eingereicht':
      return `Beleg von ${shop} erneut eingereicht.`;
    default:
      return `Beleg von ${shop} gespeichert.`;
  }
}

/** The Kostenstelle whose name is the receipt's Aktion, as the Abrechnung matches them. */
export function matchingKostenstelle<T extends { name: string; archived: boolean }>(
  aktion: string,
  kostenstellen: T[],
  /** Archived ones too, e.g. to find old receipts; never to book new ones. */
  { archived = false }: { archived?: boolean } = {}
): T | undefined {
  const name = aktion.trim().toLocaleLowerCase('de');
  return kostenstellen.find(
    (k) => (archived || !k.archived) && k.name.trim().toLocaleLowerCase('de') === name
  );
}
