import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import { hasTeam, isPreviewDeployment } from '../lib/staff-auth';
import { parseId } from '../lib/db';
import type { BelegInput } from '../lib/pflege-validation';
import {
  MAX_BELEG_PHOTO_BYTES,
  MIN_BELEG_PHOTO_EDGE,
  validateBeleg,
} from '../lib/pflege-validation';
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
import { getJpegSize, isJpeg } from '../lib/jpeg';
import type { BelegCheck } from '../lib/beleg-check';
import {
  BelegCheckLimitError,
  checkBelegPhoto,
  checkBelegRotation,
  isBelegCheckConfigured,
} from '../lib/beleg-check';
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

const FORBIDDEN = errorResponse(
  403,
  'FORBIDDEN',
  'Das darf nur die Kasse oder die Person, die den Beleg eingereicht hat.'
);

/** Whether the user may see all receipts and accept or reject them: the team „Kasse“. */
export function isBelegReviewer(principal: ClientPrincipal): boolean {
  return hasTeam(principal, 'kasse');
}

function isOwner(beleg: StaffBeleg, principal: ClientPrincipal): boolean {
  return (
    beleg.submittedBy !== '' &&
    beleg.submittedBy.toLowerCase() === principal.userDetails.toLowerCase()
  );
}

/**
 * The names the user goes by: in the Entra directory and as the linked CampFlow person. Static
 * Web Apps does not pass the name claim on, so these are what an Auslage names.
 */
async function ownNames(principal: ClientPrincipal): Promise<string[]> {
  const login = principal.userDetails.toLowerCase();
  const [users, ich] = await Promise.allSettled([
    taskDirectory.getTaskDirectoryUsers(),
    getIch(login),
  ]);
  const names: string[] = [];
  // Written like saved receipts: trimmed, single spaces
  if (users.status === 'fulfilled') {
    const me = users.value.find((user) => user.login.toLowerCase() === login);
    if (me?.name) names.push(me.name.trim().replace(/\s+/g, ' '));
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

/** Uploaders may still change, replace or withdraw their receipt until it is accepted. */
function mayChange(beleg: StaffBeleg, principal: ClientPrincipal): boolean {
  return isBelegReviewer(principal) || (isOwner(beleg, principal) && beleg.status !== 'Angenommen');
}

/** Today in Germany as `YYYY-MM-DD`; receipts are dated in local time. */
export function todayInBerlin(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now);
}

/** Checks an uploaded photo; returns an error response if it cannot be used. */
function checkPhoto(bytes: Uint8Array): HttpResponseInit | undefined {
  if (bytes.length === 0) {
    return errorResponse(400, 'INVALID', 'Bitte ein Foto des Belegs hinzufügen.');
  }
  if (bytes.length > MAX_BELEG_PHOTO_BYTES) {
    return errorResponse(413, 'TOO_LARGE', 'Das Foto ist zu groß (höchstens 4 MB).');
  }
  if (!isJpeg(bytes)) {
    return errorResponse(400, 'INVALID', 'Bitte ein Foto im JPEG-Format hochladen.');
  }
  const size = getJpegSize(bytes);
  if (!size || Math.max(size.width, size.height) < MIN_BELEG_PHOTO_EDGE) {
    return errorResponse(
      400,
      'INVALID',
      'Das Foto ist zu klein, um den Beleg zu lesen. Bitte näher heran oder mit höherer Auflösung fotografieren.'
    );
  }
  return undefined;
}

/** Decodes the base64 photo of a new receipt; invalid input yields an empty array. */
function decodePhoto(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return new Uint8Array();
  return new Uint8Array(Buffer.from(value, 'base64'));
}

/** Runs the preliminary check; a failing check never blocks storing the receipt. */
async function runCheck(
  bytes: Uint8Array,
  context: InvocationContext
): Promise<BelegCheck | undefined> {
  try {
    return await checkBelegPhoto(bytes);
  } catch (error: unknown) {
    context.warn('[belege] KI-Prüfung fehlgeschlagen', error);
    return undefined;
  }
}

/** Reads and checks `photo` and the optional `original` of a JSON body. */
function readPhotos(body: Record<string, unknown> | null): BelegPhotos | HttpResponseInit {
  const photo = decodePhoto(body?.photo);
  const invalidPhoto = checkPhoto(photo);
  if (invalidPhoto) return invalidPhoto;
  if (body?.original === undefined || body.original === null) return { photo };
  const original = decodePhoto(body.original);
  return checkPhoto(original) ?? { photo, original };
}

function isPhotos(value: BelegPhotos | HttpResponseInit): value is BelegPhotos {
  return 'photo' in value;
}

/** The check of a new photo, if a model is configured; never blocks storing the receipt. */
function startCheck(
  bytes: Uint8Array,
  context: InvocationContext
): Promise<BelegCheck | undefined> | undefined {
  return isBelegCheckConfigured() ? runCheck(bytes, context) : undefined;
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
      const names = await ownNames(principal);
      // The browser does not know the user's names, so the server marks their Auslagen
      const markMine = (beleg: StaffBeleg): StaffBeleg =>
        isAuslageOf(beleg, names) ? { ...beleg, mine: true } : beleg;
      if (isBelegReviewer(principal))
        return ok((await getBelege()).map(toStaffBeleg).map(markMine));
      // Own receipts, and to look at the ones someone else submitted for the user's Auslage
      // The database narrows the list, so other people's receipts are never read
      const belege = (await getBelege({ submittedBy: principal.userDetails, auslageNames: names }))
        .map(toStaffBeleg)
        .filter((beleg) => isOwner(beleg, principal) || isAuslageOf(beleg, names))
        .map((beleg) => (isOwner(beleg, principal) ? beleg : { ...beleg, readOnly: true as const }))
        .map(markMine);
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
    const check = startCheck(photos.photo, context);
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
      if (!mayChange(beleg, principal)) return FORBIDDEN;
      await deleteBeleg(id, etag);
      return NO_CONTENT;
    }
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

    const body = await readJsonBody(request);
    const input = validateBeleg(body, todayInBerlin());
    const etag = requireVersion(readEtag(body));
    const previous = await getBeleg(id);
    if (!previous) return NOT_FOUND;
    if (!mayChange(previous, principal)) return FORBIDDEN;
    if (!isBelegReviewer(principal)) {
      // Uploaders correct their details and resubmit a rejected receipt, nothing more
      const resubmit = previous.status === 'Abgelehnt' && input.status === 'Eingereicht';
      if (input.status !== previous.status && !resubmit) return FORBIDDEN;
      input.reviewNote = previous.reviewNote;
    }
    // The version this change wrote, so a follow-up (e.g. the transfer to CampFlow) never takes
    // someone else's later change for it
    const saved = await updateBeleg(id, input, etag, principal.userDetails);

    // Only the uploader corrects and resubmits; the Kasse resetting a decision mails nobody
    if (
      previous.status === 'Abgelehnt' &&
      input.status === 'Eingereicht' &&
      isOwner(previous, principal)
    ) {
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
        shop: input.shop,
        date: input.date,
        amountCent: input.amountCent,
        paidBy: input.paidBy,
        payout: input.payout,
        aktion: input.aktion,
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
    if (!isBelegReviewer(principal) && !isOwner(beleg, principal)) {
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
      const bytes = await readBelegPhoto(id, beleg.photo, original ? 'original' : 'photo');
      if (!bytes) return NOT_FOUND;
      const headers: Record<string, string> = {
        ...NO_STORE_HEADERS,
        'Content-Type': 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
      };
      if (request.query.get('download')) {
        headers['Content-Disposition'] = encodeContentDisposition(
          downloadFileName(beleg, Boolean(original))
        );
      }
      return { status: 200, headers, body: new Uint8Array(bytes) };
    }
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;
    if (!mayChange(beleg, principal)) return FORBIDDEN;

    // Reject photo changes based on an outdated version of the receipt
    const etag = requireVersion(readIfMatch(request));
    const photos = readPhotos(await readJsonBody(request));
    if (!isPhotos(photos)) return photos;

    const check = startCheck(photos.photo, context);
    return ok(await setBelegPhoto(id, photos, etag, check, principal.userDetails));
  }
);

/**
 * POST: checks the JPEG in the body before it is submitted, to show problems right away and
 * prefill the form. With `?nur=drehung` it answers only how to turn the photo upright
 * (`rotation`), which the form does before the check. `available` is false without a model.
 */
export const BelegPruefungEndpoint = pflegeHandler(
  'belege-pruefung',
  async (request: HttpRequest) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const onlyRotation = request.query.get('nur') === 'drehung';
    if (!isBelegCheckConfigured()) {
      return ok(
        onlyRotation ? { available: false, rotation: 0 } : { available: false, check: null }
      );
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    const invalidPhoto = checkPhoto(bytes);
    if (invalidPhoto) return invalidPhoto;
    try {
      if (onlyRotation) {
        return ok({ available: true, rotation: (await checkBelegRotation(bytes)) ?? 0 });
      }
      return ok({ available: true, check: await checkBelegPhoto(bytes) });
    } catch (error: unknown) {
      if (error instanceof BelegCheckLimitError) {
        return errorResponse(
          429,
          'CHECK_LIMIT',
          'Die KI-Prüfung hat ihr Tageslimit erreicht. Du kannst den Beleg trotzdem einreichen.'
        );
      }
      return errorResponse(
        502,
        'CHECK_UNAVAILABLE',
        'Die KI-Prüfung ist gerade nicht erreichbar. Du kannst den Beleg trotzdem einreichen.'
      );
    }
  }
);

/**
 * POST: transfers an accepted receipt to CampFlow (`costUnitId`, `categoryId` and the `etag` of
 * the receipt in the body) and deletes it afterwards; see `beleg-campflow.ts`. Kasse only.
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
    const costUnitId = typeof body?.costUnitId === 'string' ? body.costUnitId : '';
    const categoryId = typeof body?.categoryId === 'string' ? body.categoryId : '';
    if (!/^cun_\w+$/.test(costUnitId) || !/^cat_\w+$/.test(categoryId)) {
      return errorResponse(400, 'INVALID', 'Bitte Kostenstelle und Kategorie wählen.');
    }
    try {
      return ok(
        await transferBelegToCampflow(id, etag, { costUnitId, categoryId }, principal.userDetails)
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
export const BelegPruefung = withErrorHandling(BelegPruefungEndpoint);
export const BelegCampflow = withErrorHandling(BelegCampflowEndpoint);
export const BelegeCampflow = withErrorHandling(BelegeCampflowEndpoint);
