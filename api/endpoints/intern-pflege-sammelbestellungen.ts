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
} from '../lib/sammelbestellung-list';
import {
  object,
  validateSammelCampaign,
  validateSammelStatus,
} from '../lib/sammelbestellung-validation';
import { ValidationError } from '../lib/pflege-validation';
import { requireSammelVersion, sammelHandler } from './sammelbestellungen';

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

export const SammelStaffCampaign = sammelHandler(
  pflegeHandler('sammelbestellungen', async (request) => {
    const campaign = await getSammelCampaign(request.params.id);
    if (!campaign) return NOT_FOUND;
    return ok({
      campaign,
      invitationUrl: sammelUrl('campaign', campaign.id),
      orders: (await getSammelOrders(campaign.id)).map(publicSammelOrder),
    });
  })
);

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
