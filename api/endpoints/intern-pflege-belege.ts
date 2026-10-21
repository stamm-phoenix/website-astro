import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import { CONFIG } from '../lib/config';
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
import { belegMailSender, sendBelegRejectedMail } from '../lib/beleg-mails';
import { getSiteUrl } from '../lib/site-url';
import { encodeContentDisposition, errorResponse, withErrorHandling } from '../lib/response-utils';
import { getJpegSize, isJpeg } from '../lib/jpeg';
import type { BelegCheck } from '../lib/beleg-check';
import { BelegCheckLimitError, checkBelegPhoto, isBelegCheckConfigured } from '../lib/beleg-check';
import type { BelegPhotos, StaffBeleg } from '../lib/beleg-list';
import {
  createBeleg,
  deleteBeleg,
  getBeleg,
  getBelege,
  setBelegPhoto,
  toStaffBeleg,
  updateBeleg,
} from '../lib/beleg-list';
import { readBelegPhoto } from '../lib/beleg-photos';

export type { StaffBeleg } from '../lib/beleg-list';
export { originalFileName } from '../lib/beleg-photos';

/** Previews are requested with the receipt's etag in the URL, so a short private cache is safe. */
const PRIVATE_CACHE_HEADERS = { 'Cache-Control': 'private, max-age=300' };

const FORBIDDEN = errorResponse(
  403,
  'FORBIDDEN',
  'Das darf nur die Kasse oder die Person, die den Beleg eingereicht hat.'
);

/**
 * Whether the user may see all receipts and accept or reject them. `CONFIG.belege.reviewers`
 * lists the logins of the Kasse; without any every leader may review.
 */
export function isBelegReviewer(principal: ClientPrincipal): boolean {
  const reviewers = CONFIG.belege.reviewers.map((login) => login.toLowerCase());
  return reviewers.length === 0 || reviewers.includes(principal.userDetails.toLowerCase());
}

function isOwner(beleg: StaffBeleg, principal: ClientPrincipal): boolean {
  return (
    beleg.submittedBy !== '' &&
    beleg.submittedBy.toLowerCase() === principal.userDetails.toLowerCase()
  );
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

/** GET: all receipts, newest first; POST: submit a receipt with its photo. */
export const BelegeCollectionEndpoint = pflegeHandler(
  'belege',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
    if (request.method === 'GET') {
      const reviewer = isBelegReviewer(principal);
      // The database narrows the list to the uploader's receipts; the exact check stays here
      const belege = (await getBelege(reviewer ? undefined : principal.userDetails))
        .map(toStaffBeleg)
        .filter((beleg) => reviewer || isOwner(beleg, principal));
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
    return ok({ id }, 201);
  }
);

/**
 * PATCH: update details and review state (optimistic locking via etag). Rejecting a receipt
 * mails the reason to the uploader; `mailed` says whether that worked. DELETE: remove.
 */
export const BelegItemEndpoint = pflegeHandler(
  'belege',
  async (request: HttpRequest, context: InvocationContext, principal: ClientPrincipal) => {
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
    await updateBeleg(id, input, etag, principal.userDetails);

    const rejected = input.status === 'Abgelehnt' && previous.status !== 'Abgelehnt';
    if (!rejected) return ok({ mailed: false });
    return ok({ mailed: await mailRejection(previous, input, principal, request, context) });
  }
);

/** Sends the rejection mail; a failure never undoes the saved decision. */
async function mailRejection(
  beleg: StaffBeleg,
  input: BelegInput,
  principal: ClientPrincipal,
  request: HttpRequest,
  context: InvocationContext
): Promise<boolean> {
  const sender = belegMailSender();
  if (!sender || !beleg.submittedBy.includes('@')) return false;
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
      sender
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
    if (!isBelegReviewer(principal) && !isOwner(beleg, principal)) return NOT_FOUND;

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
 * prefill the form. `available` is false if no model is configured.
 */
export const BelegPruefungEndpoint = pflegeHandler(
  'belege-pruefung',
  async (request: HttpRequest) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    if (!isBelegCheckConfigured()) return ok({ available: false, check: null });

    const bytes = new Uint8Array(await request.arrayBuffer());
    const invalidPhoto = checkPhoto(bytes);
    if (invalidPhoto) return invalidPhoto;
    try {
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

/** File name for the CampFlow upload, e.g. `2026-10-01 REWE 12,34 EUR.jpg`. */
export function downloadFileName(beleg: StaffBeleg, original = false): string {
  const amount = (beleg.amountCent / 100).toFixed(2).replace('.', ',');
  const shop = beleg.shop.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Beleg';
  const suffix = original ? ' Original' : '';
  return `${beleg.date || 'Beleg'} ${shop} ${amount} EUR${suffix}.jpg`.replace(/\s+/g, ' ');
}

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
