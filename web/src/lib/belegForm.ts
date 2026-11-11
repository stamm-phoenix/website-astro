import { fetchFile } from './api';
import { parseEuroToCent } from './belege';
import { todayIso, formatDateTime } from './format';
import type { BelegArt, BelegCampflow, BelegCheck, BelegStatus, StaffBeleg } from './types';
export interface BelegForm {
  id: string | null;
  etag: string;
  /** An expense or income; income asks nothing about an Auslage. */
  art: BelegArt;
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
  isPdf: boolean;
  submittedBy: string;
  submittedAt: string;
  aiCheck: BelegCheck | null;
  campflow: BelegCampflow | null;
  submittedByName?: string;
  /** Whether the user may change it; a new receipt always. */
  editable?: boolean;
}

/**
 * How a receipt was paid: by a person who gets the money back (`auslage`), by the Stamm (card or
 * cash box) or as a transfer to the savings book. All but the Stamm are an Auslage in CampFlow.
 */
export type BelegZahlung = 'auslage' | 'stamm' | 'sparbuch';

/** What CampFlow's „Auslage durch“ says for a transfer to the savings book. */
export const SPARBUCH = 'Sparbuch';

/** The choice in the form for a stored receipt. */
export function zahlungOf(beleg: { payout: boolean; paidBy: string }): BelegZahlung {
  if (!beleg.payout) return 'stamm';
  return beleg.paidBy.trim() === SPARBUCH ? 'sparbuch' : 'auslage';
}

/** Switches between expense and income; income has no Auslage, so its choice goes. */
export function applyArt(form: BelegForm, art: BelegArt): void {
  if (form.art === art) return;
  form.art = art;
  form.zahlung = null;
  form.payout = art === 'Einnahme' ? false : null;
  form.paidBy = '';
}

/**
 * Sets who gets the Auslage for a choice. An Auslage starts with `vorschlag`, the name of the
 * person submitting a new receipt, which can be changed to whoever paid.
 */
export function applyZahlung(form: BelegForm, zahlung: BelegZahlung, vorschlag: string): void {
  const before = form.zahlung;
  form.zahlung = zahlung;
  form.payout = zahlung !== 'stamm';
  if (zahlung === 'sparbuch') form.paidBy = SPARBUCH;
  else if (zahlung === 'stamm') form.paidBy = '';
  // A name typed before stays; „Sparbuch“ or nothing becomes the suggestion
  else if (before !== 'auslage') form.paidBy = vorschlag;
}

export function photoUrl(beleg: { id: string | null; etag: string }, variant = ''): string {
  return `/api/intern/pflege/belege/${beleg.id}/foto?v=${encodeURIComponent(beleg.etag)}${variant}`;
}

/** Loads the stored PDF of a receipt, to draw its further pages. */
export async function ladePdf(
  beleg: { id: string | null; etag: string },
  signal: AbortSignal
): Promise<Blob> {
  const file = await fetchFile(photoUrl(beleg, '&download=1').replace(/^\/api/, ''), signal);
  return file.blob;
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
  const einnahme = f.art === 'Einnahme';
  if (!f.id && !hasPhoto) result.photo = 'Bitte ein Foto oder PDF des Belegs hinzufügen.';
  if (!f.shop.trim()) {
    result.shop = einnahme ? 'Bitte angeben, von wem das Geld kam.' : 'Bitte das Geschäft angeben.';
  }
  if (!f.date) result.date = 'Bitte das Datum angeben.';
  else if (f.date > todayIso()) result.date = 'Das Datum liegt in der Zukunft.';
  if (parseEuroToCent(f.amount) === null)
    result.amountCent = 'Bitte einen Betrag wie 12,34 angeben.';
  // Income has no Auslage
  if (!einnahme && f.zahlung === null) result.payout = 'Bitte auswählen, wie bezahlt wurde.';
  else if (!einnahme && f.zahlung === 'auslage' && !f.paidBy.trim()) {
    result.paidBy = 'Bitte angeben, wer das Geld ausgelegt hat.';
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
  submittedBy: string,
  /** The status before, to tell taking back an acceptance from resubmitting. */
  previous?: BelegStatus
): string {
  switch (decision) {
    case 'Angenommen':
      return `Beleg von ${shop} angenommen. Jetzt nach CampFlow übertragen.`;
    case 'Abgelehnt':
      return mailed
        ? `Beleg von ${shop} abgelehnt. ${submittedBy} hat die Begründung per Mail bekommen.`
        : `Beleg von ${shop} abgelehnt. Es wurde keine Mail verschickt, bitte gib ${submittedBy || 'der Person'} selbst Bescheid.`;
    case 'Eingereicht':
      return previous === 'Angenommen'
        ? `Annahme des Belegs von ${shop} zurückgenommen. Er lässt sich jetzt wieder bearbeiten.`
        : `Beleg von ${shop} erneut eingereicht.`;
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

/** Whether the form differs from the stored receipt in a field the API saves. */
export function belegChanged(current: BelegForm, stored: StaffBeleg): boolean {
  return (
    current.art !== stored.art ||
    current.shop !== stored.shop ||
    current.date !== stored.date ||
    parseEuroToCent(current.amount) !== stored.amountCent ||
    current.paidBy !== stored.paidBy ||
    current.payout !== stored.payout ||
    current.kostenstelle !== stored.kostenstelle ||
    current.kategorie !== stored.kategorie ||
    current.note !== stored.note ||
    current.reviewNote !== stored.reviewNote ||
    current.etag !== stored.etag
  );
}
