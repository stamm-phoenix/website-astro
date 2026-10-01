import { sammelInvitationStep } from '../lib/sammelbestellung-invitations';
import { isSammelOpen } from '../lib/sammelbestellung-model';
import { CampflowError } from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import { getGraphStatus } from '../lib/sharepoint-data-access';
import { escapeHtml } from '../lib/mail';
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
import { ValidationError } from '../lib/pflege-validation';
import { requireSammelVersion, sammelHandler } from './sammelbestellungen';
import { getPrincipalFirstName } from '../lib/staff-auth';
import { sendSammelStaffMessage } from '../lib/sammelbestellung-mails';
import { getSammelProduct, sammelProductReference } from '../lib/sammelbestellung-product-resolver';
import { getSammelAutomaticTotal } from '../lib/sammelbestellung-total';
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
    if (typeof body.creationKey !== 'string' || !/^[a-f0-9-]{36}$/.test(body.creationKey)) {
      throw new ValidationError({ creationKey: 'Bitte öffne das Formular erneut.' });
    }
    const input = validateSammelCampaign(body);
    const id = await createSammelCampaign(input, body.creationKey);
    return ok({ id }, 201);
  })
);

/** Returns staff campaign details or applies a version-checked archive change. */
export const SammelStaffCampaign = sammelHandler(
  pflegeHandler('sammelbestellungen', async (request) => {
    const campaign = await getSammelCampaign(request.params.id);
    if (!campaign) return NOT_FOUND;
    if (request.method === 'PATCH') {
      const body = object(await readJsonBody(request));
      const versionError = requireSammelVersion(body.etag, campaign.etag);
      if (versionError) return versionError;
      if (typeof body.archived !== 'boolean')
        throw new ValidationError({ archived: 'Bitte gib den Archivstatus an.' });
      await setSammelCampaignArchived(campaign.id, body.archived, campaign.etag);
      return NO_CONTENT;
    }
    return ok({
      campaign,
      invitationUrl: sammelUrl(getSiteUrl(request), 'campaign', campaign.id),
      orders: (await getSammelOrders(campaign.id)).map(publicSammelOrder),
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
    const totalCents =
      input.totalCents === null && ['Bestellt', 'Eingetroffen'].includes(input.status)
        ? await getSammelAutomaticTotal(order.items)
        : input.totalCents;
    await updateSammelOrder(
      order.id,
      {
        Status: input.status,
        Bezahlt: input.paid,
        Ausgeliefert: input.delivered,
        BetragCent: totalCents,
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
    if (
      !Number.isInteger(body.index) ||
      Number(body.index) < 0 ||
      Number(body.index) >= order.items.length ||
      typeof body.excluded !== 'boolean'
    )
      throw new ValidationError({ form: 'Bitte wähle einen Artikel und seinen Bestellstatus.' });
    const reason = text(body.reason, 'reason', 1000, true);
    const items = order.items.map((item) => ({ ...item }));
    const item = items[Number(body.index)];
    if (!!item.excluded === body.excluded)
      return errorResponse(
        409,
        'ITEM_ALREADY_UPDATED',
        'Der Artikel hat bereits diesen Status. Bitte lade die Bestellung neu.'
      );
    if (body.excluded) item.excluded = { reason };
    else delete item.excluded;
    await updateSammelOrder(
      order.id,
      { Artikel: JSON.stringify(items), BetragCent: null, Bezahlt: false },
      order.etag
    );
    try {
      await sendSammelStaffMessage(
        campaign,
        { ...publicSammelOrder(order), items },
        {
          subject: body.excluded
            ? 'Artikel wird nicht mitbestellt'
            : 'Artikel wird wieder mitbestellt',
          messageHtml:
            '<p>' +
            escapeHtml(
              item.quantity + ' × ' + item.name + (item.variant ? ' · ' + item.variant : '')
            ) +
            (body.excluded ? ' wird nicht mitbestellt.' : ' wird wieder mitbestellt.') +
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
    if (body.action !== 'preview' && body.action !== 'send')
      throw new ValidationError({ form: 'Bitte wähle Vorschau oder Versand.' });
    try {
      return ok(
        await sammelInvitationStep(campaign, body.action, getSiteUrl(request), body.version)
      );
    } catch (error: unknown) {
      if (error instanceof CampflowError) return campflowErrorResponse(error);
      if (
        error instanceof ValidationError ||
        error instanceof InvalidSammelDataError ||
        getGraphStatus(error) === 412
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
