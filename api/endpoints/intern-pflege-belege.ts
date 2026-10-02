import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { ClientPrincipal } from '../lib/staff-auth';
import { EnvironmentVariable, getEnvironment } from '../lib/environment';
import {
  createSharePointListItem,
  deleteSharePointListItem,
  getSharePointListItem,
  getSharePointListItems,
  updateSharePointListItem,
} from '../lib/sharepoint-data-access';
import {
  addListItemAttachment,
  deleteListItemAttachment,
  getListItemAttachment,
  toImageFieldValue,
  validateUpdateListItem,
} from '../lib/sharepoint-rest';
import type { BelegInput, BelegStatus } from '../lib/pflege-validation';
import {
  BELEG_STATUSES,
  MAX_BELEG_PHOTO_BYTES,
  MIN_BELEG_PHOTO_EDGE,
  validateBeleg,
} from '../lib/pflege-validation';
import {
  CONFLICT,
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
import { encodeContentDisposition, errorResponse, withErrorHandling } from '../lib/response-utils';
import { fetchSharePointImage, getJpegSize, isJpeg } from '../lib/sharepoint-images';

const IMAGE_FIELD = 'Beleg';
/** Thumbnails are requested with the item's etag in the URL, so a short private cache is safe. */
const PRIVATE_CACHE_HEADERS = { 'Cache-Control': 'private, max-age=300' };

interface BelegListItem {
  id: string;
  eTag?: string;
  createdDateTime?: string;
  fields: {
    Title?: string;
    Belegdatum?: string;
    BetragCent?: number;
    BezahltVon?: string;
    Auszahlung?: boolean;
    Aktion?: string;
    Bemerkung?: string;
    Status?: string;
    Pruefnotiz?: string;
    Ausgezahlt?: boolean;
    EingereichtVon?: string;
    Beleg?: string;
  };
}

/** A receipt as sent to the Leitendenbereich. */
export interface StaffBeleg {
  id: string;
  etag: string;
  shop: string;
  date: string;
  amountCent: number;
  paidBy: string;
  payout: boolean;
  aktion: string;
  note: string;
  status: BelegStatus;
  reviewNote: string;
  paidOut: boolean;
  submittedBy: string;
  submittedAt: string;
  hasImage: boolean;
}

function listId(): string {
  return getEnvironment(EnvironmentVariable.SHAREPOINT_BELEGE_LIST_ID);
}

/** Today in Germany as `YYYY-MM-DD`; receipts are dated in local time. */
export function todayInBerlin(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now);
}

/** File name of the photo referenced by the image column, if any. */
function photoFileName(item: BelegListItem): string | undefined {
  if (!item.fields.Beleg) return undefined;
  try {
    const parsed: unknown = JSON.parse(item.fields.Beleg);
    const fileName = (parsed as { fileName?: unknown })?.fileName;
    return typeof fileName === 'string' && fileName ? fileName : undefined;
  } catch {
    return undefined;
  }
}

function toStatus(value: string | undefined): BelegStatus {
  return (BELEG_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as BelegStatus)
    : 'Eingereicht';
}

export function toStaffBeleg(item: BelegListItem): StaffBeleg {
  const fields = item.fields;
  return {
    id: item.id,
    etag: item.eTag ?? '',
    shop: fields.Title ?? '',
    date: fields.Belegdatum ?? '',
    amountCent: typeof fields.BetragCent === 'number' ? fields.BetragCent : 0,
    paidBy: fields.BezahltVon ?? '',
    payout: fields.Auszahlung === true,
    aktion: fields.Aktion ?? '',
    note: fields.Bemerkung ?? '',
    status: toStatus(fields.Status),
    reviewNote: fields.Pruefnotiz ?? '',
    paidOut: fields.Ausgezahlt === true,
    submittedBy: fields.EingereichtVon ?? '',
    submittedAt: item.createdDateTime ?? '',
    hasImage: photoFileName(item) !== undefined,
  };
}

function toGraphFields(input: BelegInput): Record<string, unknown> {
  return {
    Title: input.shop,
    Belegdatum: input.date,
    BetragCent: input.amountCent,
    BezahltVon: input.paidBy,
    Auszahlung: input.payout,
    Aktion: input.aktion,
    Bemerkung: input.note,
    Status: input.status,
    Pruefnotiz: input.reviewNote,
    Ausgezahlt: input.paidOut,
  };
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

/** Attaches the photo and points the image column to it. */
async function storePhoto(id: string, bytes: Uint8Array): Promise<string> {
  // A new name per upload, so browsers don't show the old photo after a replacement
  const fileName = `beleg-${Date.now()}.jpg`;
  await addListItemAttachment(listId(), id, fileName, new Uint8Array(bytes));
  await validateUpdateListItem(listId(), id, {
    [IMAGE_FIELD]: toImageFieldValue(IMAGE_FIELD, fileName),
  });
  return fileName;
}

/** GET: all receipts, newest first; POST: submit a receipt with its photo. */
export const BelegeCollectionEndpoint = pflegeHandler(
  'belege',
  async (request: HttpRequest, _context, principal: ClientPrincipal) => {
    if (request.method === 'GET') {
      const items = (await getSharePointListItems(listId(), {
        expand: 'fields',
      })) as BelegListItem[];
      const belege = items
        .filter((item) => item && /^\d+$/.test(item.id))
        .map(toStaffBeleg)
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || Number(b.id) - Number(a.id));
      return ok(belege);
    }
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;

    const body = await readJsonBody(request);
    const input = validateBeleg(body, todayInBerlin());
    // New receipts always start unchecked
    input.status = 'Eingereicht';
    input.reviewNote = '';
    input.paidOut = false;

    const photo = decodePhoto(body?.photo);
    const invalidPhoto = checkPhoto(photo);
    if (invalidPhoto) return invalidPhoto;

    const id = await createSharePointListItem(listId(), {
      ...toGraphFields(input),
      EingereichtVon: principal.userDetails,
    });
    try {
      await storePhoto(id, photo);
    } catch (error: unknown) {
      // A receipt without its photo is of no use to the Kassenteam
      await deleteSharePointListItem(listId(), id).catch(() => undefined);
      throw error;
    }
    return ok({ id }, 201);
  }
);

/** PATCH: update details and review state (optimistic locking via etag); DELETE: remove. */
export const BelegItemEndpoint = pflegeHandler('belege', async (request: HttpRequest) => {
  const id = request.params.id ?? '';
  if (!/^\d+$/.test(id)) return NOT_FOUND;

  if (request.method === 'DELETE') {
    await deleteSharePointListItem(listId(), id, requireVersion(readIfMatch(request)));
    return NO_CONTENT;
  }
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

  const body = await readJsonBody(request);
  const input = validateBeleg(body, todayInBerlin());
  await updateSharePointListItem(
    listId(),
    id,
    toGraphFields(input),
    requireVersion(readEtag(body))
  );
  return NO_CONTENT;
});

/** GET: the photo (`?thumb=1` as preview, `?download=1` as file); PUT: replace it with the JPEG in the body. */
export const BelegPhotoEndpoint = pflegeHandler(
  'belege-foto',
  async (request: HttpRequest, context: InvocationContext) => {
    const id = request.params.id ?? '';
    if (!/^\d+$/.test(id)) return NOT_FOUND;

    const item = (await getSharePointListItem(listId(), id)) as BelegListItem | undefined;
    if (!item) return NOT_FOUND;
    const previous = photoFileName(item);

    if (request.method === 'GET') {
      if (!previous) return NOT_FOUND;
      if (request.query.get('thumb')) {
        const thumbnail = await fetchSharePointImage(listId(), id, previous, '480x480', context);
        return {
          ...thumbnail,
          headers: { ...(thumbnail.headers as Record<string, string>), ...PRIVATE_CACHE_HEADERS },
        };
      }
      const bytes = await getListItemAttachment(listId(), id, previous);
      const beleg = toStaffBeleg(item);
      const headers: Record<string, string> = {
        ...NO_STORE_HEADERS,
        'Content-Type': 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
      };
      if (request.query.get('download')) {
        headers['Content-Disposition'] = encodeContentDisposition(downloadFileName(beleg));
      }
      return { status: 200, headers, body: bytes };
    }
    if (request.method !== 'PUT') return METHOD_NOT_ALLOWED;

    // Reject photo changes based on an outdated version of the receipt
    if (requireVersion(readIfMatch(request)) !== item.eTag) return CONFLICT;

    const bytes = new Uint8Array(await request.arrayBuffer());
    const invalidPhoto = checkPhoto(bytes);
    if (invalidPhoto) return invalidPhoto;

    const fileName = await storePhoto(id, bytes);
    if (previous && previous !== fileName) {
      await deleteListItemAttachment(listId(), id, previous);
    }
    return ok({ hasImage: true });
  }
);

/** File name for the CampFlow upload, e.g. `2026-10-01 REWE 12,34 EUR.jpg`. */
export function downloadFileName(beleg: StaffBeleg): string {
  const amount = (beleg.amountCent / 100).toFixed(2).replace('.', ',');
  const shop = beleg.shop.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Beleg';
  return `${beleg.date || 'Beleg'} ${shop} ${amount} EUR.jpg`.replace(/\s+/g, ' ');
}

export const BelegeCollection = withErrorHandling(BelegeCollectionEndpoint);
export const BelegItem = withErrorHandling(BelegItemEndpoint);
export const BelegPhoto = withErrorHandling(BelegPhotoEndpoint);
