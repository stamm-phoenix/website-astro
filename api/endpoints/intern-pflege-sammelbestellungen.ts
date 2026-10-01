import { pflegeHandler, ok, readJsonBody, NOT_FOUND, NO_CONTENT } from '../lib/pflege-api';
import {
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
} from '../lib/sammelbestellung-validation';
import { ValidationError } from '../lib/pflege-validation';
import { requireSammelVersion, sammelHandler } from './sammelbestellungen';
import { getPrincipalFirstName } from '../lib/staff-auth';
import { sendSammelStaffMessage } from '../lib/sammelbestellung-mails';
import { errorResponse } from '../lib/response-utils';

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
        sammelUrl('order', order.id)
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
      invitationUrl: sammelUrl('campaign', campaign.id),
      orders: (await getSammelOrders(campaign.id)).map(publicSammelOrder),
    });
  })
);

/** Updates submitted orders with staff-only fields after checking their loaded version. */
export const SammelStaffOrder = sammelHandler(
  pflegeHandler('sammelbestellungen', async (request) => {
    const order = await getSammelOrder(request.params.id);
    if (!order) return NOT_FOUND;
    if (!order.submitted)
      throw new ValidationError({ form: 'Diese Person hat noch keine Bestellung abgegeben.' });
    const body = object(await readJsonBody(request));
    const versionError = requireSammelVersion(body.etag, order.etag);
    if (versionError) return versionError;
    const input = validateSammelStatus(body);
    await updateSammelOrder(
      order.id,
      {
        Status: input.status,
        Bezahlt: input.paid,
        Ausgeliefert: input.delivered,
        BetragCent: input.totalCents,
      },
      order.etag
    );
    return NO_CONTENT;
  })
);
