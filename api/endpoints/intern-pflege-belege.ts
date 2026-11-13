import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import { isPreviewDeployment } from '../lib/staff-auth';
import {
  changesDetails,
  isBelegReviewer,
  isUploader as isOwner,
  mayDeleteBeleg,
  mayEditBeleg,
  seesAllBelege,
} from '../lib/beleg-rechte';
import { parseId } from '../lib/db';
import type { BelegInput } from '../lib/validation/beleg';
import { validateBeleg } from '../lib/validation/beleg';
import { isPhotos, readPhotos } from '../lib/validation/beleg-upload';
import {
  METHOD_NOT_ALLOWED,
  NO_CONTENT,
  NO_STORE_HEADERS,
  NOT_FOUND,
  ok,
  pflegeHandler,
  readEtag,
  readIfMatch,
  readJsonBody,
  requireVersion,
} from '../lib/pflege-api';
import {
  belegMailSender,
  belegReviewerAddresses,
  sendBelegRejectedMail,
  sendBelegSubmittedMail,
} from '../lib/beleg-mails';
import { getSiteUrl } from '../lib/site-url';
import { encodeContentDisposition, errorResponse, withErrorHandling } from '../lib/response-utils';
import type { BelegCheck } from '../lib/beleg-check';
import { checkBelegPhoto, isBelegCheckConfigured } from '../lib/beleg-check';
import type { BelegPhotos, StaffBeleg } from '../lib/beleg-list';
import {
  createBeleg,
  deleteBeleg,
  downloadFileName,
  getBeleg,
  getBelege,
  setBelegPhoto,
  toStaffBeleg,
  updateBeleg,
} from '../lib/beleg-list';
import { readBelegPhoto } from '../lib/beleg-photos';
import { BelegCampflowError, transferBelegToCampflow } from '../lib/beleg-campflow';
import { readCampflowBelege } from '../lib/campflow-belege';
import { getCampflowBelege, PlaywrightApiError } from '../lib/playwright-api';
import { getIch } from '../lib/personen';
import { sameName } from '../lib/personen-model';
import * as taskDirectory from '../lib/task-directory';
import type { TaskDirectoryUser } from '../lib/task-directory-types';

export type { StaffBeleg } from '../lib/beleg-list';
export { downloadFileName } from '../lib/beleg-list';
export { originalFileName } from '../lib/beleg-photos';

/** The time of a request from its start; Static Web Apps cuts it off after 45 seconds. */
const REQUEST_BUDGET_MS = 40_000;
/** The mail to the Kasse is left out when less than this is left of the request's time. */
const MIN_MAIL_BUDGET_MS = 2_000;

/** Resolves with `fallback` once `deadline` has passed, so a slow lookup never holds the answer. */
export function beforeDeadline<T>(promise: Promise<T>, deadline: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), Math.max(0, deadline - Date.now()));
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Previews are requested with the receipt's etag in the URL, so a short private cache is safe. */
const PRIVATE_CACHE_HEADERS = { 'Cache-Control': 'private, max-age=300' };

export { isBelegReviewer } from '../lib/beleg-rechte';

const FORBIDDEN = errorResponse(
  403,
  'FORBIDDEN',
  'Das darf nur die Kasse, der Vorstand oder die Person, die den Beleg eingereicht hat.'
);

const ACCEPTED = errorResponse(
  403,
  'FORBIDDEN',
  'Ein angenommener Beleg lässt sich nicht mehr ändern. Die Kasse kann die Annahme zurücknehmen.'
);

/** The people of the Entra directory; none when it cannot be read. */
async function directoryUsers(): Promise<TaskDirectoryUser[]> {
  try {
    return await taskDirectory.getTaskDirectoryUsers();
  } catch {
    return [];
  }
}

/** Written like saved receipts: trimmed, single spaces. */
function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * The names the user goes by: in the Entra directory and as the linked CampFlow person. Static
 * Web Apps does not pass the name claim on, so these are what an Auslage names.
 */
async function ownNames(
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
function isAuslageOf(beleg: { payout: boolean; paidBy: string }, names: string[]): boolean {
  return beleg.payout && names.some((name) => sameName(name, beleg.paidBy));
}

/** Today in Germany as `YYYY-MM-DD`; receipts are dated in local time. */
export function todayInBerlin(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now);
}

/** Runs the preliminary check; a failing check never blocks storing the receipt. */
async function runCheck(
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
function startCheck(
  photos: BelegPhotos,
  context: InvocationContext
): Promise<BelegCheck | undefined> | undefined {
  return isBelegCheckConfigured()
    ? runCheck([photos.photo, ...(photos.pages ?? [])], context)
    : undefined;
}

/**
 * GET: all receipts, newest first; POST: submit a receipt with its photo and tell the Kasse
 * about it by mail.
 */
export const BelegeCollectionEndpoint = pflegeHandler(
  'belege',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    const deadline = Date.now() + REQUEST_BUDGET_MS;
    if (request.method === 'GET') {
      const users = await directoryUsers();
      const names = await ownNames(principal, users);
      const byLogin = new Map(users.map((user) => [user.login.toLowerCase(), user.name]));
      // The browser does not know the user's names, so the server marks their Auslagen; it also
      // names who submitted a receipt and says whether the user may still change it
      const describe = (beleg: StaffBeleg): StaffBeleg => {
        const submitter = byLogin.get(beleg.submittedBy.toLowerCase());
        return {
          ...beleg,
          ...(isAuslageOf(beleg, names) ? { mine: true as const } : {}),
          ...(submitter ? { submittedByName: cleanName(submitter) } : {}),
          editable: !beleg.readOnly && mayEditBeleg(beleg, principal),
        };
      };
      if (seesAllBelege(principal)) return ok((await getBelege()).map(toStaffBeleg).map(describe));
      // Own receipts, and to look at the ones someone else submitted for the user's Auslage
      // The database narrows the list, so other people's receipts are never read
      const belege = (await getBelege({ submittedBy: principal.userDetails, auslageNames: names }))
        .map(toStaffBeleg)
        .filter((beleg) => isOwner(beleg, principal) || isAuslageOf(beleg, names))
        .map((beleg) => (isOwner(beleg, principal) ? beleg : { ...beleg, readOnly: true as const }))
        .map(describe);
      return ok(belege);
    }
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;

    const body = await readJsonBody(request);
    const input = validateBeleg(body, todayInBerlin());
    // New receipts always start unchecked
    input.status = 'Eingereicht';
    input.reviewNote = '';

    const photos = readPhotos(body);
    if (!isPhotos(photos)) return photos;

    // The model takes a few seconds; let it work while the photo is stored
    const check = startCheck(photos, context);
    const id = await createBeleg(input, principal.userDetails, photos, check);
    await beforeDeadline(
      notifyKasse(input, false, principal, request, context, deadline),
      deadline,
      undefined
    );
    return ok({ id }, 201);
  }
);

/**
 * PATCH: update details and review state (optimistic locking via etag); answers with the new
 * `etag`. Rejecting a receipt mails the reason to the uploader; `mailed` says whether that
 * worked. A receipt its uploader resubmits is mailed to the Kasse again. DELETE: remove.
 */
export const BelegItemEndpoint = pflegeHandler(
  'belege',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    const deadline = Date.now() + REQUEST_BUDGET_MS;
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;

    if (request.method === 'DELETE') {
      const etag = requireVersion(readIfMatch(request));
      const beleg = await getBeleg(id);
      if (!beleg) return NOT_FOUND;
      if (!mayDeleteBeleg(beleg, principal)) return FORBIDDEN;
      await deleteBeleg(id, etag);
      return NO_CONTENT;
    }
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

    const body = await readJsonBody(request);
    const etag = requireVersion(readEtag(body));
    const previous = await getBeleg(id);
    if (!previous) return NOT_FOUND;
    const reviewer = isBelegReviewer(principal);
    const editor = mayEditBeleg(previous, principal);
    if (!reviewer && !editor)
      return previous.status === 'Angenommen' && isOwner(previous, principal)
        ? ACCEPTED
        : FORBIDDEN;
    const input = validateBeleg(body, todayInBerlin(), previous.aktion);
    // An accepted receipt keeps its details; the Kasse may still change its decision
    if (!editor && changesDetails(previous, input)) return ACCEPTED;
    if (!reviewer) {
      // Others correct the details and resubmit a rejected receipt, nothing more
      const resubmit = previous.status === 'Abgelehnt' && input.status === 'Eingereicht';
      if (input.status !== previous.status && !resubmit) return FORBIDDEN;
      input.reviewNote = previous.reviewNote;
    }
    // The version this change wrote, so a follow-up (e.g. the transfer to CampFlow) never takes
    // someone else's later change for it
    const saved = await updateBeleg(id, input, etag, principal.userDetails);

    // A resubmitted receipt goes to the Kasse again; the Kasse resetting a decision mails nobody
    if (previous.status === 'Abgelehnt' && input.status === 'Eingereicht' && !reviewer) {
      await beforeDeadline(
        notifyKasse(input, true, principal, request, context, deadline),
        deadline,
        undefined
      );
    }
    const rejected = input.status === 'Abgelehnt' && previous.status !== 'Abgelehnt';
    if (!rejected) return ok({ mailed: false, etag: saved });
    return ok({
      // Graph or its sign-in may hang; the decision is saved, so answer in time without the mail
      mailed: await beforeDeadline(
        mailRejection(previous, input, principal, request, context, deadline),
        deadline,
        false
      ),
      etag: saved,
    });
  }
);

/**
 * Tells the members of the team „Kasse“ that a receipt waits for their check, within what is
 * left of the request's time (`deadline`): the receipt is already saved, so the answer must not
 * run into the time limit and make the uploader submit it twice. A failure never undoes the
 * saved receipt; PR previews hold made-up receipts and send nothing.
 */
async function notifyKasse(
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
  const left = (): number => deadline - Date.now() - MIN_MAIL_BUDGET_MS;
  try {
    if (left() <= 0) throw new Error('Keine Zeit mehr für die Mail');
    const [recipients, names] = await Promise.all([
      belegReviewerAddresses(
        principal.userDetails,
        AbortSignal.timeout(Math.min(5_000, Math.max(1, left())))
      ),
      beforeDeadline(ownNames(principal), deadline - MIN_MAIL_BUDGET_MS, []),
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
async function mailRejection(
  beleg: StaffBeleg,
  input: BelegInput,
  principal: ClientPrincipal,
  request: HttpRequest,
  context: InvocationContext,
  deadline: number
): Promise<boolean> {
  const sender = belegMailSender();
  if (!sender || isPreviewDeployment() || !beleg.submittedBy.includes('@')) return false;
  const left = deadline - Date.now() - MIN_MAIL_BUDGET_MS;
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

/**
 * GET: the photo (`?thumb=1` as preview, `?original=1` for the unedited photo, `?download=1`
 * as file); PUT: replace it with `photo` and the optional `original` of the JSON body.
 */
export const BelegPhotoEndpoint = pflegeHandler(
  'belege-foto',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;

    const beleg = await getBeleg(id);
    if (!beleg) return NOT_FOUND;
    if (!seesAllBelege(principal) && !isOwner(beleg, principal)) {
      // Who laid out the money may look at the photo, not change it
      if (request.method !== 'GET' || !isAuslageOf(beleg, await ownNames(principal))) {
        return NOT_FOUND;
      }
    }

    if (request.method === 'GET') {
      if (!beleg.photo) return NOT_FOUND;
      if (request.query.get('thumb')) {
        const thumbnail = await readBelegPhoto(id, beleg.photo, 'thumb');
        if (!thumbnail) return NOT_FOUND;
        return {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'X-Content-Type-Options': 'nosniff',
            ...PRIVATE_CACHE_HEADERS,
          },
          body: new Uint8Array(thumbnail),
        };
      }
      const original = request.query.get('original');
      const download = request.query.get('download');
      // A PDF is downloaded as such; shown, it is the picture of its first page
      const pdf = beleg.isPdf && !original && download;
      const bytes = await readBelegPhoto(
        id,
        beleg.photo,
        original ? 'original' : pdf ? 'file' : 'photo'
      );
      if (!bytes) return NOT_FOUND;
      const headers: Record<string, string> = {
        ...NO_STORE_HEADERS,
        'Content-Type': pdf ? 'application/pdf' : 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
      };
      if (download) {
        headers['Content-Disposition'] = encodeContentDisposition(
          downloadFileName(beleg, Boolean(original))
        );
      }
      return { status: 200, headers, body: new Uint8Array(bytes) };
    }
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    if (!mayEditBeleg(beleg, principal)) {
      return beleg.status === 'Angenommen' ? ACCEPTED : FORBIDDEN;
    }

    // Reject photo changes based on an outdated version of the receipt
    const etag = requireVersion(readIfMatch(request));
    const photos = readPhotos(await readJsonBody(request));
    if (!isPhotos(photos)) return photos;

    const check = startCheck(photos, context);
    return ok(await setBelegPhoto(id, photos, etag, check, principal.userDetails));
  }
);

/**
 * POST: transfers an accepted receipt to CampFlow (the `etag` of the receipt in the body), booked
 * on its Kostenstelle and Kategorie, and deletes it afterwards; see `beleg-campflow.ts`. Kasse
 * only.
 */
export const BelegCampflowEndpoint = pflegeHandler(
  'belege-campflow',
  async (request: HttpRequest, _context: InvocationContext, principal: ClientPrincipal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const id = parseId(request.params.id ?? '');
    if (id === undefined) return NOT_FOUND;
    if (!isBelegReviewer(principal)) return FORBIDDEN;

    const body = await readJsonBody(request);
    const etag = requireVersion(readEtag(body));
    try {
      return ok(
        await transferBelegToCampflow(
          id,
          etag,
          principal.userDetails,
          Date.now() + REQUEST_BUDGET_MS
        )
      );
    } catch (error: unknown) {
      if (error instanceof BelegCampflowError) return error.toResponse();
      throw error;
    }
  }
);

/**
 * GET: every receipt in CampFlow with its booking and payment state, read-only and for every
 * leader, like the Beiträge. The Playwright API serves its last read; `?refresh=true` reads
 * CampFlow again. Receipts transferred from here carry who submitted them, as a flag for the user.
 */
export const BelegeCampflowEndpoint = pflegeHandler(
  'belege-campflow-liste',
  async (request: HttpRequest, _context: InvocationContext, principal: ClientPrincipal) => {
    if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
    try {
      const belege = await readCampflowBelege(
        await getCampflowBelege({ refresh: request.query.get('refresh') === 'true' }),
        principal.userDetails,
        await ownNames(principal)
      );
      return { status: 200, headers: NO_STORE_HEADERS, jsonBody: belege };
    } catch (error: unknown) {
      if (!(error instanceof PlaywrightApiError)) throw error;
      if (error.status === 503) {
        return errorResponse(
          502,
          'CAMPFLOW_BELEGE_UNAVAILABLE',
          'Für die Belege aus CampFlow ist kein CampFlow-Zugang eingerichtet. Bitte melde dich bei admin@stamm-phoenix.de.'
        );
      }
      return errorResponse(
        502,
        'CAMPFLOW_BELEGE_UNAVAILABLE',
        'Die Belege konnten nicht aus CampFlow geladen werden. Versuche es in ein paar Minuten noch einmal; klappt es dann nicht, melde dich bei admin@stamm-phoenix.de.'
      );
    }
  }
);

/** GET: whether the user belongs to the Kasse, so the page can show the review controls. */
export const BelegRolleEndpoint = pflegeHandler(
  'belege-rolle',
  async (request: HttpRequest, _context: InvocationContext, principal: ClientPrincipal) => {
    if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
    return ok({ reviewer: isBelegReviewer(principal) });
  }
);

export const BelegeCollection = withErrorHandling(BelegeCollectionEndpoint);
export const BelegRolle = withErrorHandling(BelegRolleEndpoint);
export const BelegItem = withErrorHandling(BelegItemEndpoint);
export const BelegPhoto = withErrorHandling(BelegPhotoEndpoint);
export const BelegCampflow = withErrorHandling(BelegCampflowEndpoint);
export const BelegeCampflow = withErrorHandling(BelegeCampflowEndpoint);

app.http('internPflegeBelege', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege',
  handler: BelegeCollection,
});

// Registered before `belege/{id}` as well
app.http('internPflegeBelegeCampflow', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/campflow',
  handler: BelegeCampflow,
});

app.http('internPflegeBelegRolle', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/rolle',
  handler: BelegRolle,
});

app.http('internPflegeBelegItem', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/{id}',
  handler: BelegItem,
});

app.http('internPflegeBelegFoto', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/{id}/foto',
  handler: BelegPhoto,
});

app.http('internPflegeBelegCampflow', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/belege/{id}/campflow',
  handler: BelegCampflow,
});
