import { parseEuroToCent } from './belege';
import { todayIso } from './format';
import type { BelegCheck, BelegStatus } from './types';
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
}

export function photoUrl(beleg: { id: string | null; etag: string }, variant = ''): string {
  return `/api/intern/pflege/belege/${beleg.id}/foto?v=${encodeURIComponent(beleg.etag)}${variant}`;
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
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
      return `Beleg von ${shop} angenommen. Jetzt das Foto herunterladen, in CampFlow hochladen und den Beleg hier löschen.`;
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
