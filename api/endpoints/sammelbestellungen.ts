import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { sendSammelLinkMail, sendSammelSavedMail } from '../lib/sammelbestellung-mails';
import { readJsonBody, NO_STORE_HEADERS } from '../lib/nikolaus-api';
import { errorResponse, withErrorHandling } from '../lib/response-utils';
import { getGraphStatus } from '../lib/sharepoint-data-access';
import { ValidationError } from '../lib/pflege-validation';
import { isSammelOpen, canEditSammelOrder } from '../lib/sammelbestellung-model';
import {
  getSammelCampaign,
  getSammelOrder,
  ensureSammelOrder,
  verifySammelToken,
  sammelUrl,
  publicSammelOrder,
  updateSammelOrder,
  InvalidSammelDataError,
} from '../lib/sammelbestellung-list';
import { email, text, validateSammelItems } from '../lib/sammelbestellung-validation';
import { getRuesthausProduct, ruesthausProductUrl } from '../lib/ruesthaus-product';
import { reserveSammelLinkRequest } from '../lib/sammelbestellung-link-quota';

const INVALID_LINK = errorResponse(
  404,
  'INVALID_LINK',
  'Dieser Link ist ungültig. Bitte verwende den vollständigen Link aus deiner E-Mail.'
);
const CLOSED = errorResponse(
  403,
  'CLOSED',
  'Der Bestellzeitraum ist geschlossen oder deine Bestellung wird bereits bearbeitet.'
);
const CONFLICT = errorResponse(
  409,
  'CONFLICT',
  'Die Bestellung wurde inzwischen geändert. Bitte neu laden und erneut versuchen.'
);
const LINK_COOLDOWN_MS = 15 * 60_000;
interface ProductLookupQuota {
  count: number;
  expiresAt: number;
}
const productLookups = new Map<string, ProductLookupQuota>();

/** Adds no-store even to validation, conflict and upstream-error responses. */
export function sammelHandler(
  handler: (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>
): (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit> {
  const safe = withErrorHandling(async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error: unknown) {
      if (error instanceof InvalidSammelDataError)
        return errorResponse(503, 'INVALID_STORED_DATA', error.message);
      if (error instanceof ValidationError)
        return {
          status: 400,
          jsonBody: { code: 'INVALID', message: error.message, fields: error.fields },
        };
      if ([409, 412].includes(getGraphStatus(error) ?? 0)) return CONFLICT;
      throw error;
    }
  });
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const response = await safe(request, context);
    return { ...response, headers: { ...response.headers, ...NO_STORE_HEADERS } };
  };
}

/** Requires a concrete quoted ETag and reports stale versions without writing. */
export function requireSammelVersion(value: unknown, actual: string): HttpResponseInit | undefined {
  if (typeof value !== 'string' || !/^(?:W\/)?"[^"\r\n]+"$/.test(value)) {
    return errorResponse(400, 'VERSION_REQUIRED', 'Die Version fehlt. Bitte neu laden.');
  }
  return value === actual ? undefined : CONFLICT;
}

/** Returns an open campaign only after checking its invitation token. */
export const SammelCampaignLookup = sammelHandler(async (request) => {
  const body = await readJsonBody(request);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!verifySammelToken('campaign', id, body?.token)) return INVALID_LINK;
  const campaign = await getSammelCampaign(id);
  if (!campaign) return INVALID_LINK;
  if (!isSammelOpen(campaign)) return CLOSED;
  return { jsonBody: campaign };
});

/** A shared CampFlow invitation opens this route; only the recipient gets the personal link. */
export const SammelRequestLink = sammelHandler(async (request, context) => {
  const body = await readJsonBody(request);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!verifySammelToken('campaign', id, body?.token)) return INVALID_LINK;
  const campaign = await getSammelCampaign(id);
  if (!campaign) return INVALID_LINK;
  if (!isSammelOpen(campaign)) return CLOSED;
  const address = email(body?.email);
  const accepted: HttpResponseInit = { jsonBody: { sent: true } };
  if (typeof body?.website === 'string' && body.website.trim()) return accepted;
  if (!(await reserveSammelLinkRequest(id))) {
    context.log(`[sammelbestellungen] Link request limit reached for campaign ${id}`);
    return errorResponse(
      429,
      'LINK_LIMIT',
      'Es wurden gerade viele Bestelllinks angefordert. Bitte versuche es später erneut.'
    );
  }
  const order = await ensureSammelOrder(id, address);
  const now = new Date();
  if (Date.parse(order.linkSentAt) > now.getTime() - LINK_COOLDOWN_MS) return accepted;
  // Reserving the cooldown through the loaded ETag makes concurrent requests send at most one mail.
  try {
    await updateSammelOrder(order.id, { LinkGesendetAm: now.toISOString() }, order.etag);
  } catch (error: unknown) {
    if (getGraphStatus(error) === 412) return accepted;
    throw error;
  }
  try {
    const url = sammelUrl('order', order.id);
    await sendSammelLinkMail(address, campaign, url);
  } catch (error: unknown) {
    context.error('Sending Sammelbestellung link failed', error);
    // Do not overwrite concurrent member/staff edits while clearing a failed mail reservation.
    const current = await getSammelOrder(order.id);
    if (current?.linkSentAt === now.toISOString()) {
      try {
        await updateSammelOrder(order.id, { LinkGesendetAm: order.linkSentAt }, current.etag);
      } catch (restoreError: unknown) {
        context.error('Restoring mail cooldown failed', restoreError);
      }
    }
    return errorResponse(
      502,
      'MAIL_FAILED',
      'Die E-Mail konnte nicht versendet werden. Bitte versuche es später erneut.'
    );
  }
  return accepted;
});

/** Returns one token-authorized order and its current editing eligibility. */
export const SammelOrderLookup = sammelHandler(async (request) => {
  const body = await readJsonBody(request);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!verifySammelToken('order', id, body?.token)) return INVALID_LINK;
  const order = await getSammelOrder(id);
  const campaign = order ? await getSammelCampaign(order.campaignId) : undefined;
  if (!order || !campaign) return INVALID_LINK;
  return {
    jsonBody: {
      campaign,
      order: publicSammelOrder(order),
      canEdit: canEditSammelOrder(campaign, order),
    },
  };
});

/** Provides bounded product suggestions only for an editable token-authorized order. */
export const SammelProductLookup = sammelHandler(async (request, context) => {
  const body = await readJsonBody(request);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!verifySammelToken('order', id, body?.token)) return INVALID_LINK;
  const order = await getSammelOrder(id);
  const campaign = order ? await getSammelCampaign(order.campaignId) : undefined;
  if (!order || !campaign) return INVALID_LINK;
  if (!canEditSammelOrder(campaign, order)) return CLOSED;
  const url = ruesthausProductUrl(body?.reference);
  const now = Date.now();
  for (const [key, value] of productLookups) if (value.expiresAt <= now) productLookups.delete(key);
  const quota = productLookups.get(id) ?? { count: 0, expiresAt: now + 60_000 };
  if (quota.count >= 30 || (!productLookups.has(id) && productLookups.size >= 1000))
    return errorResponse(
      429,
      'LOOKUP_LIMIT',
      'Bitte warte eine Minute, bevor du weitere Produktdaten lädst.'
    );
  quota.count++;
  productLookups.set(id, quota);
  try {
    return { jsonBody: await getRuesthausProduct(url) };
  } catch (error: unknown) {
    context.error('Ruesthaus product lookup failed', error);
    return errorResponse(
      502,
      'PRODUCT_UNAVAILABLE',
      'Die Produktdaten konnten nicht geladen werden. Du kannst den Artikel weiterhin selbst eintragen.'
    );
  }
});

/** Saves a version-checked member order before attempting its confirmation email. */
export const SammelOrderSave = sammelHandler(async (request, context) => {
  const body = await readJsonBody(request);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!verifySammelToken('order', id, body?.token)) return INVALID_LINK;
  const order = await getSammelOrder(id);
  const campaign = order ? await getSammelCampaign(order.campaignId) : undefined;
  if (!body || !order || !campaign) return INVALID_LINK;
  if (!canEditSammelOrder(campaign, order)) return CLOSED;
  const versionError = requireSammelVersion(body.etag, order.etag);
  if (versionError) return versionError;
  const items = validateSammelItems(body.items);
  const name = text(body.name, 'name', 200);
  const notes = text(body.notes, 'notes', 2000, true);
  // Email, prices, payment and processing status are deliberately not member-writable.
  await updateSammelOrder(
    order.id,
    {
      Title: name,
      Artikel: JSON.stringify(items),
      Bemerkungen: notes,
      Eingereicht: true,
      BetragCent: null,
      Bezahlt: false,
    },
    order.etag
  );
  try {
    await sendSammelSavedMail(
      campaign,
      {
        ...publicSammelOrder(order),
        name,
        items,
        notes,
        submitted: true,
        totalCents: null,
        paid: false,
      },
      sammelUrl('order', order.id),
      !order.submitted
    );
    return { status: 200, jsonBody: { confirmationMailSent: true } };
  } catch (error: unknown) {
    context.error('Sending Sammelbestellung confirmation failed after saving', error);
    return { status: 200, jsonBody: { confirmationMailSent: false } };
  }
});
