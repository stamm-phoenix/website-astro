import type { HttpRequest, InvocationContext } from '@azure/functions';
import { belegMailSender, belegReviewerAddresses, sendBelegSubmittedMail } from './beleg-mails';
import { belegSubmittedSmsText, mobileNumbersOf } from './beleg-sms';
import { getSiteUrl } from './site-url';
import { isSmsConfigured, sendSms } from './sms';
import type { ClientPrincipal } from './staff-auth';
import { isPreviewDeployment } from './staff-auth';
import type { BelegInput } from './validation/beleg';

/** The notes to the Kasse are left out when less than this is left of the request's time. */
export const MIN_MAIL_BUDGET_MS = 2_000;

/** Resolves with `fallback` once `deadline` has passed, so a slow lookup never holds the answer. */
export function beforeDeadline<T>(promise: Promise<T>, deadline: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), Math.max(0, deadline - Date.now()));
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * Tells the members of the team „Kasse“ that a receipt waits for their check, by mail and, to
 * those with a linked CampFlow person and a mobile number there, by SMS (`docs/sms.md`). All of
 * it stays within what is left of the request's time (`deadline`): the receipt is already saved,
 * so the answer must not run into the time limit and make the uploader submit it twice. A
 * failure never undoes the saved receipt; PR previews hold made-up receipts and send nothing.
 * @param ownNames The names the submitter goes by; the first one is shown.
 */
export async function notifyKasse(
  input: BelegInput,
  resubmitted: boolean,
  principal: ClientPrincipal,
  request: HttpRequest,
  context: InvocationContext,
  deadline: number,
  ownNames: () => Promise<string[]>
): Promise<void> {
  const sender = belegMailSender();
  const sms = isSmsConfigured();
  if ((!sender && !sms) || isPreviewDeployment()) return;
  // Leave the notes out rather than risk the answer
  const left = (): number => deadline - Date.now() - MIN_MAIL_BUDGET_MS;
  try {
    if (left() <= 0) throw new Error('Keine Zeit mehr für die Benachrichtigung');
    const [recipients, names] = await Promise.all([
      belegReviewerAddresses(
        principal.userDetails,
        AbortSignal.timeout(Math.min(5_000, Math.max(1, left())))
      ),
      beforeDeadline(ownNames(), deadline - MIN_MAIL_BUDGET_MS, []),
    ]);
    if (recipients.length === 0) return;
    if (left() <= 0) throw new Error('Keine Zeit mehr für die Benachrichtigung');
    const submitter = names[0] ?? principal.userDetails;
    const url = `${getSiteUrl(request)}/leitendenbereich/belege`;
    await Promise.all([
      sender &&
        sendBelegSubmittedMail(
          {
            art: input.art,
            shop: input.shop,
            date: input.date,
            amountCent: input.amountCent,
            paidBy: input.paidBy,
            payout: input.payout,
            aktion: input.aktion,
            kostenstelle: input.kostenstelle,
            kategorie: input.kategorie,
            note: input.note,
            submitter,
            resubmitted,
            url,
          },
          recipients,
          sender,
          left()
        ).then(
          (failed) => {
            if (failed.length > 0) {
              context.warn(
                `[belege] Mail an die Kasse an ${failed.length} Person(en) fehlgeschlagen`
              );
            }
          },
          (error: unknown) => context.warn('[belege] Mail an die Kasse fehlgeschlagen', error)
        ),
      sms &&
        smsToKasse(
          recipients,
          belegSubmittedSmsText({
            art: input.art,
            shop: input.shop,
            amountCent: input.amountCent,
            submitter,
            resubmitted,
            url,
          }),
          left,
          deadline,
          context
        ),
    ]);
  } catch (error: unknown) {
    context.warn('[belege] Kasse konnte nicht benachrichtigt werden', error);
  }
}

/** Looks up the mobile numbers of the Kasse and sends the SMS; failures are only logged. */
async function smsToKasse(
  logins: string[],
  message: string,
  left: () => number,
  deadline: number,
  context: InvocationContext
): Promise<void> {
  try {
    // CampFlow answers each person on its own; a slow one must not hold the answer
    const numbers = await beforeDeadline(
      mobileNumbersOf(logins),
      deadline - MIN_MAIL_BUDGET_MS,
      []
    );
    if (numbers.length === 0 || left() <= 0) return;
    const failed = await sendSms(numbers, message, Math.min(10_000, left()));
    if (failed.length > 0) {
      context.warn(`[belege] SMS an die Kasse an ${failed.length} Nummer(n) fehlgeschlagen`);
    }
  } catch (error: unknown) {
    context.warn('[belege] SMS an die Kasse fehlgeschlagen', error);
  }
}
