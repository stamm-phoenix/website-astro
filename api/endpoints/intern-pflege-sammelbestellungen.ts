import { sammelInvitationStep } from '../lib/sammelbestellung-invitations';
import { isSammelOpen } from '../lib/sammelbestellung-model';
import { CampflowError } from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import { escapeHtml } from '../lib/mail';
import { VersionConflictError } from '../lib/db';
import { pflegeHandler, ok, readJsonBody, NOT_FOUND, NO_CONTENT } from '../lib/pflege-api';
import {
  InvalidSammelDataError,
  createSammelCampaign,
  getSammelCampaigns,
  getSammelCampaign,
  getSammelOrders,
  getSammelOrder,
  sammelUrl,
  publicSammelOrder,
  updateSammelOrder,
  setSammelCampaignArchived,
} from '../lib/sammelbestellung-list';
import {
  object,
  validateSammelCampaign,
  validateSammelStatus,
  validateSammelMessage,
  text,
} from '../lib/sammelbestellung-validation';
import { ValidationError } from '../lib/validation/errors';
import {
  validateSammelArchived,
  validateSammelCreationKey,
  validateSammelInviteAction,
  validateSammelItemStatus,
} from '../lib/validation/sammel-input';
import { requireSammelVersion, sammelHandler } from './sammelbestellungen';
import { getPrincipalFirstName } from '../lib/staff-auth';
import { sendSammelStaffMessage } from '../lib/sammelbestellung-mails';
import { getSammelProduct, sammelProductReference } from '../lib/sammelbestellung-product-resolver';
import { errorResponse } from '../lib/response-utils';
import { getSiteUrl } from '../lib/site-url';
import {
  guardSammelPaymentStatus,
  sammelManualSettlementValues,
} from '../lib/sammelbestellung-payments';

/** Sends a validated staff message to the persisted recipient after version checks. */
export const SammelStaffMessage = sammelHandler(
  pflegeHandler('sammelbestellungen-nachricht', async (request, context, principal) => {
    const order = await getSammelOrder(request.params.id);
    const campaign = order ? await getSammelCampaign(order.campaignId) : undefined;
    if (!order || !campaign) return NOT_FOUND;
    if (!order.submitted)
      throw new ValidationError({ form: 'Diese Person hat noch keine Bestellung abgegeben.' });
    const body = object(await readJsonBody(request));
    const versionError = requireSammelVersion(body.etag, order.etag);
    if (versionError) return versionError;
    const input = validateSammelMessage(body);
    try {
      await sendSammelStaffMessage(
        campaign,
        publicSammelOrder(order),
        input,
        getPrincipalFirstName(principal),
        sammelUrl(getSiteUrl(request), 'order', order.id)
      );
      return NO_CONTENT;
    } catch (error: unknown) {
      context.error('Sending Sammelbestellung staff message failed', error);
      return errorResponse(
        502,
        'MAIL_FAILED',
        'Die Nachricht konnte nicht verschickt werden. Bitte versuche es später erneut.'
      );
    }
  })
);

/** Lists or creates campaigns after staff authentication and input validation. */
export const SammelStaffCampaigns = sammelHandler(
  pflegeHandler('sammelbestellungen', async (request) => {
    if (request.method === 'GET') return ok(await getSammelCampaigns());
    const body = object(await readJsonBody(request));
    const creationKey = validateSammelCreationKey(body);
    const input = validateSammelCampaign(body);
    const id = await createSammelCampaign(input, creationKey);
    return ok({ id }, 201);
  })
);

/** Returns staff campaign details or applies a version-checked archive change. */
export const SammelStaffCampaign = sammelHandler(
  pflegeHandler('sammelbestellungen', async (request) => {
    // The orders need only the ID, so they are read together with the campaign
    const [campaign, orders] = await Promise.all([
      getSammelCampaign(request.params.id),
      request.method === 'PATCH' ? undefined : getSammelOrders(request.params.id),
    ]);
    if (!campaign) return NOT_FOUND;
    if (request.method === 'PATCH') {
      const body = object(await readJsonBody(request));
      const versionError = requireSammelVersion(body.etag, campaign.etag);
      if (versionError) return versionError;
      const archived = validateSammelArchived(body);
      await setSammelCampaignArchived(campaign.id, archived, campaign.etag);
      return NO_CONTENT;
    }
    return ok({
      campaign,
      invitationUrl: sammelUrl(getSiteUrl(request), 'campaign', campaign.id),
      orders: (orders ?? []).map(publicSammelOrder),
    });
  })
);

/** Updates submitted orders with staff-only fields after checking their loaded version. */
export const SammelStaffOrder = sammelHandler(
  pflegeHandler('sammelbestellungen', async (request, _context, principal) => {
    const order = await getSammelOrder(request.params.id);
    if (!order) return NOT_FOUND;
    if (!order.submitted)
      throw new ValidationError({ form: 'Diese Person hat noch keine Bestellung abgegeben.' });
    const body = object(await readJsonBody(request));
    const versionError = requireSammelVersion(body.etag, order.etag);
    if (versionError) return versionError;
    const input = validateSammelStatus(body);
    guardSammelPaymentStatus(order, input.status, input.totalCents, input.paid);
    await updateSammelOrder(
      order.id,
      {
        status: input.status,
        paid: input.paid,
        delivered: input.delivered,
        totalCents: input.totalCents,
        ...sammelManualSettlementValues(order, input.paid, principal),
      },
      order.etag
    );
    return NO_CONTENT;
  })
);

/** Fetches indicative shop prices for authenticated staff without changing stored order totals. */
export const SammelStaffProduct = sammelHandler(
  pflegeHandler('sammelbestellungen-produkt', async (request, context) => {
    const body = object(await readJsonBody(request));
    const url = sammelProductReference(body.reference);
    try {
      return ok(await getSammelProduct(url));
    } catch (error: unknown) {
      context.error('Staff Shop product lookup failed', error);
      return errorResponse(
        502,
        'PRODUCT_UNAVAILABLE',
        'Der Shop-Preis konnte nicht geladen werden.'
      );
    }
  })
);

/** Changes a persisted item without deleting it and informs its recipient. */
export const SammelStaffItem = sammelHandler(
  pflegeHandler('sammelbestellungen-artikel', async (request, context, principal) => {
    const order = await getSammelOrder(request.params.id);
    const campaign = order ? await getSammelCampaign(order.campaignId) : undefined;
    if (!order || !campaign) return NOT_FOUND;
    if (!order.submitted || order.status === 'Storniert')
      throw new ValidationError({ form: 'Diese Bestellung kann nicht bearbeitet werden.' });
    if (order.payment?.locked)
      throw new ValidationError({
        form: 'Die Artikel sind durch den CampFlow-Beitrag gesperrt. Korrekturen bitte zuerst in CampFlow klären.',
      });
    const body = object(await readJsonBody(request));
    const versionError = requireSammelVersion(body.etag, order.etag);
    if (versionError) return versionError;
    const { index, excluded } = validateSammelItemStatus(body, order.items.length);
    const reason = text(body.reason, 'reason', 1000, true);
    const items = order.items.map((item) => ({ ...item }));
    const item = items[index];
    if (!!item.excluded === excluded)
      return errorResponse(
        409,
        'ITEM_ALREADY_UPDATED',
        'Der Artikel hat bereits diesen Status. Bitte lade die Bestellung neu.'
      );
    if (excluded) item.excluded = { reason };
    else delete item.excluded;
    await updateSammelOrder(order.id, { items, totalCents: null, paid: false }, order.etag);
    try {
      await sendSammelStaffMessage(
        campaign,
        { ...publicSammelOrder(order), items },
        {
          subject: excluded ? 'Artikel wird nicht mitbestellt' : 'Artikel wird wieder mitbestellt',
          messageHtml:
            '<p>' +
            escapeHtml(
              item.quantity + ' × ' + item.name + (item.variant ? ' · ' + item.variant : '')
            ) +
            (excluded ? ' wird nicht mitbestellt.' : ' wird wieder mitbestellt.') +
            '</p>' +
            (reason ? '<p>' + escapeHtml(reason) + '</p>' : ''),
        },
        getPrincipalFirstName(principal),
        sammelUrl(getSiteUrl(request), 'order', order.id)
      );
      return ok({ confirmationMailSent: true });
    } catch (error: unknown) {
      context.error('Item status saved but notification failed', error);
      return ok({ confirmationMailSent: false });
    }
  })
);

/** Counts the CampFlow audience or advances the confirmed, deduplicated invitation delivery. */
export const SammelStaffInvite = sammelHandler(
  pflegeHandler('sammelbestellungen-freigabe', async (request, context) => {
    const campaign = await getSammelCampaign(request.params.id);
    if (!campaign) return NOT_FOUND;
    if (!isSammelOpen(campaign))
      throw new ValidationError({
        form: 'Nur aktuell offene Sammelbestellungen können freigegeben werden.',
      });
    const body = object(await readJsonBody(request));
    const action = validateSammelInviteAction(body);
    try {
      return ok(await sammelInvitationStep(campaign, action, getSiteUrl(request), body.version));
    } catch (error: unknown) {
      if (error instanceof CampflowError) return campflowErrorResponse(error);
      if (
        error instanceof ValidationError ||
        error instanceof InvalidSammelDataError ||
        error instanceof VersionConflictError
      )
        throw error;
      context.error('Campaign invitation delivery failed', error);
      return errorResponse(
        502,
        'INVITATION_FAILED',
        'Der Versand wurde unterbrochen. Bereits versuchte Adressen werden nicht automatisch erneut angeschrieben. Lade den Versandstand erneut.'
      );
    }
  })
);
