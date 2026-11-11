import { hasTeam, type ClientPrincipal } from './staff-auth';
import type { BelegInput } from './validation/beleg';

/** What the rules need to know about a stored receipt. */
interface BelegStand {
  submittedBy: string;
  status: string;
  art: string;
  shop: string;
  date: string;
  amountCent: number;
  paidBy: string;
  payout: boolean;
  kostenstelle: string;
  kategorie: string;
  note: string;
}

/** Whether the user checks receipts: sees all of them and accepts or rejects them. */
export function isBelegReviewer(principal: ClientPrincipal): boolean {
  return hasTeam(principal, 'kasse');
}

/** Whether the user sees every receipt: the Kasse and the Vorstand. */
export function seesAllBelege(principal: ClientPrincipal): boolean {
  return isBelegReviewer(principal) || hasTeam(principal, 'vorstand');
}

export function isUploader(beleg: { submittedBy: string }, principal: ClientPrincipal): boolean {
  return (
    beleg.submittedBy !== '' &&
    beleg.submittedBy.toLowerCase() === principal.userDetails.toLowerCase()
  );
}

/**
 * Whether the user may change the details or the photo of a receipt: the Kasse, the Vorstand
 * and who submitted it, as long as the Kasse has not accepted it.
 */
export function mayEditBeleg(beleg: BelegStand, principal: ClientPrincipal): boolean {
  if (beleg.status === 'Angenommen') return false;
  return seesAllBelege(principal) || isUploader(beleg, principal);
}

/** Whether the user may delete a receipt: like changing it, and the Kasse also once accepted. */
export function mayDeleteBeleg(beleg: BelegStand, principal: ClientPrincipal): boolean {
  return isBelegReviewer(principal) || mayEditBeleg(beleg, principal);
}

/** Text as compared: older rows may differ from validated input only in spaces. */
function gleich(a: string, b: string): boolean {
  const norm = (text: string) => text.trim().replace(/\s+/g, ' ');
  return norm(a) === norm(b);
}

/** Whether a save changes more than the decision of the Kasse and its remark. */
export function changesDetails(beleg: BelegStand, input: BelegInput): boolean {
  return (
    beleg.art !== input.art ||
    beleg.amountCent !== input.amountCent ||
    beleg.payout !== input.payout ||
    !gleich(beleg.shop, input.shop) ||
    !gleich(beleg.date, input.date) ||
    !gleich(beleg.paidBy, input.paidBy) ||
    !gleich(beleg.kostenstelle, input.kostenstelle) ||
    !gleich(beleg.kategorie, input.kategorie) ||
    !gleich(beleg.note, input.note)
  );
}
