/** Helpers of the receipt endpoints (`intern-pflege-belege*.ts`): own names, deadlines, the check and the mails. */
import { berlinDay } from './dates';
import { type HttpRequest, type InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from './staff-auth';
import { isPreviewDeployment } from './staff-auth';
import type { BelegInput } from './validation/beleg';
import {
  belegMailSender,
  belegReviewerAddresses,
  sendBelegRejectedMail,
  sendBelegSubmittedMail,
} from './beleg-mails';
import { getSiteUrl } from './site-url';
import { errorResponse } from './response-utils';
import type { BelegCheck } from './beleg-check';
import { checkBelegPhoto, isBelegCheckConfigured } from './beleg-check';
import type { BelegPhotos, StaffBeleg } from './beleg-list';
import { getIch } from './personen';
import { sameName } from './personen-model';
import * as taskDirectory from './task-directory';
import type { TaskDirectoryUser } from './task-directory-types';

/** Resolves with `fallback` once `deadline` has passed, so a slow lookup never holds the answer. */
export function beforeDeadline<T>(promise: Promise<T>, deadline: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), Math.max(0, deadline - Date.now()));
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Previews are requested with the receipt's etag in the URL, so a short private cache is safe. */
export const PRIVATE_CACHE_HEADERS = { 'Cache-Control': 'private, max-age=300' };

export const FORBIDDEN = errorResponse(
  403,
  'FORBIDDEN',
  'Das darf nur die Kasse, der Vorstand oder die Person, die den Beleg eingereicht hat.'
);

export const ACCEPTED = errorResponse(
  403,
  'FORBIDDEN',
  'Ein angenommener Beleg lässt sich nicht mehr ändern. Die Kasse kann die Annahme zurücknehmen.'
);

/** The people of the Entra directory; none when it cannot be read. */
export async function directoryUsers(): Promise<TaskDirectoryUser[]> {
  try {
    return await taskDirectory.getTaskDirectoryUsers();
  } catch {
    return [];
  }
}

/** Written like saved receipts: trimmed, single spaces. */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * The names the user goes by: in the Entra directory and as the linked CampFlow person. Static
 * Web Apps does not pass the name claim on, so these are what an Auslage names.
 */
export async function ownNames(
  principal: ClientPrincipal,
  users?: TaskDirectoryUser[]
): Promise<string[]> {
  const login = principal.userDetails.toLowerCase();
  const [directory, ich] = await Promise.allSettled([users ?? directoryUsers(), getIch(login)]);
  const names: string[] = [];
  if (directory.status === 'fulfilled') {
    const me = directory.value.find((user) => user.login.toLowerCase() === login);
    if (me?.name) names.push(cleanName(me.name));
  }
  const linked = ich.status === 'fulfilled' ? ich.value.campflow : null;
  if (linked?.firstName || linked?.lastName) {
    names.push(`${linked.firstName} ${linked.lastName}`.trim().replace(/\s+/g, ' '));
  }
  return names;
}

/** An Auslage of the user: they may see the receipt, whoever submitted it. */
export function isAuslageOf(beleg: { payout: boolean; paidBy: string }, names: string[]): boolean {
  return beleg.payout && names.some((name) => sameName(name, beleg.paidBy));
}

/** Today in Germany as `YYYY-MM-DD`; receipts are dated in local time. */
export function todayInBerlin(now = new Date()): string {
  return berlinDay(now);
}

/** Runs the preliminary check; a failing check never blocks storing the receipt. */
export async function runCheck(
  pages: Uint8Array[],
  context: InvocationContext
): Promise<BelegCheck | undefined> {
  try {
    return await checkBelegPhoto(pages);
  } catch (error: unknown) {
    context.warn('[belege] KI-Prüfung fehlgeschlagen', error);
    return undefined;
  }
}

/**
 * The check of a new photo, or of the pages of a PDF, if a model is configured; never blocks
 * storing the receipt.
 */
export function startCheck(
  photos: BelegPhotos,
  context: InvocationContext
): Promise<BelegCheck | undefined> | undefined {
  return isBelegCheckConfigured()
    ? runCheck([photos.photo, ...(photos.pages ?? [])], context)
    : undefined;
}

/**
 * Tells the members of the team „Kasse“ that a receipt waits for their check, within what is
 * left of the request's time (`deadline`): the receipt is already saved, so the answer must not
 * run into the time limit and make the uploader submit it twice. A failure never undoes the
 * saved receipt; PR previews hold made-up receipts and send nothing.
 */
export async function notifyKasse(
  input: BelegInput,
  resubmitted: boolean,
  principal: ClientPrincipal,
  request: HttpRequest,
  context: InvocationContext,
  deadline: number
): Promise<void> {
  const sender = belegMailSender();
  if (!sender || isPreviewDeployment()) return;
  // Leave the mail out rather than risk the answer
  const left = (): number => deadline - Date.now() - 2_000;
  try {
    if (left() <= 0) throw new Error('Keine Zeit mehr für die Mail');
    const [recipients, names] = await Promise.all([
      belegReviewerAddresses(
        principal.userDetails,
        AbortSignal.timeout(Math.min(5_000, Math.max(1, left())))
      ),
      beforeDeadline(ownNames(principal), deadline - 2_000, []),
    ]);
    if (recipients.length === 0) return;
    if (left() <= 0) throw new Error('Keine Zeit mehr für die Mail');
    const failed = await sendBelegSubmittedMail(
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
        submitter: names[0] ?? principal.userDetails,
        resubmitted,
        url: `${getSiteUrl(request)}/leitendenbereich/belege`,
      },
      recipients,
      sender,
      left()
    );
    if (failed.length > 0) {
      context.warn(`[belege] Mail an die Kasse an ${failed.length} Person(en) fehlgeschlagen`);
    }
  } catch (error: unknown) {
    context.warn('[belege] Kasse konnte nicht benachrichtigt werden', error);
  }
}

/**
 * Sends the rejection mail; a failure never undoes the saved decision. PR previews hold
 * made-up receipts and send nothing.
 */
export async function mailRejection(
  beleg: StaffBeleg,
  input: BelegInput,
  principal: ClientPrincipal,
  request: HttpRequest,
  context: InvocationContext,
  deadline: number
): Promise<boolean> {
  const sender = belegMailSender();
  if (!sender || isPreviewDeployment() || !beleg.submittedBy.includes('@')) return false;
  const left = deadline - Date.now() - 2_000;
  if (left <= 0) return false;
  try {
    await sendBelegRejectedMail(
      {
        to: beleg.submittedBy,
        shop: input.shop,
        date: input.date,
        amountCent: input.amountCent,
        reason: input.reviewNote,
        reviewer: principal.userDetails,
        url: `${getSiteUrl(request)}/leitendenbereich/belege`,
      },
      sender,
      left
    );
    return true;
  } catch (error: unknown) {
    context.warn('[belege] Ablehnungs-Mail konnte nicht gesendet werden', error);
    return false;
  }
}
