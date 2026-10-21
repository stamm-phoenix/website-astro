import { parseEuroToCent } from './belege';
import { todayIso, formatDateTime } from './format';
import type { BelegCampflow, BelegCheck, BelegStatus } from './types';
export interface BelegForm {
  id: string | null;
  etag: string;
  shop: string;
  date: string;
  amount: string;
  paidBy: string;
  payout: boolean | null;
  aktion: string;
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

/** Where an accepted receipt is booked in CampFlow. */
export interface CampflowChoice {
  /** `cun_…` */
  costUnitId: string;
  /** `cat_…` */
  categoryId: string;
}

export function photoUrl(beleg: { id: string | null; etag: string }, variant = ''): string {
  return `/api/intern/pflege/belege/${beleg.id}/foto?v=${encodeURIComponent(beleg.etag)}${variant}`;
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : formatDateTime(date);
}
export function validateBeleg(f: BelegForm, hasPhoto: boolean): Record<string, string> {
  const result: Record<string, string> = {};
  if (!f.id && !hasPhoto) result.photo = 'Bitte ein Foto des Belegs hinzufügen.';
  if (!f.shop.trim()) result.shop = 'Bitte das Geschäft angeben.';
  if (!f.date) result.date = 'Bitte das Datum angeben.';
  else if (f.date > todayIso()) result.date = 'Das Datum liegt in der Zukunft.';
  if (parseEuroToCent(f.amount) === null)
    result.amountCent = 'Bitte einen Betrag wie 12,34 angeben.';
  if (f.payout === null) result.payout = 'Bitte auswählen, wie du bezahlt hast.';
  if (!f.paidBy.trim()) result.paidBy = 'Bitte angeben, wer bezahlt hat.';
  if (!f.aktion.trim()) result.aktion = 'Bitte die Aktion angeben.';
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
      return `Beleg von ${shop} angenommen. Jetzt Kostenstelle und Kategorie wählen und nach CampFlow übertragen.`;
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

export function knownBelegAktion(value: string, suggestions: string[]): boolean {
  const text = value.trim().toLocaleLowerCase('de');
  return suggestions.some((suggestion) => suggestion.trim().toLocaleLowerCase('de') === text);
}

/** The Kostenstelle whose name is the receipt's Aktion, as the Abrechnung matches them. */
export function matchingKostenstelle<T extends { name: string; archived: boolean }>(
  aktion: string,
  kostenstellen: T[]
): T | undefined {
  const name = aktion.trim().toLocaleLowerCase('de');
  return kostenstellen.find((k) => !k.archived && k.name.trim().toLocaleLowerCase('de') === name);
}
