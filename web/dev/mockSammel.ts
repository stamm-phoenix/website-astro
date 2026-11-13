/** Sammelbestellungen. */
import {
  campaigns,
  createCampaign,
  invitations,
  orders,
  productInfo,
  touchCampaign,
  touchOrder,
} from './mock-data/sammel';
import { MOCK_NOW } from './mock-data/util';
import { error, json, noContent, notFound, route, str } from './mockCore';
import type { MockResult } from './mockCore';
import { CAPTCHA_FAILED } from './mockKontakt';

// ---------------------------------------------------------------------------------------------
// Sammelbestellungen

function isOpen(campaign: (typeof campaigns)[number]): boolean {
  const now = MOCK_NOW;
  return (
    !campaign.archived && Date.parse(campaign.startsAt) <= now && now < Date.parse(campaign.endsAt)
  );
}

function campaignById(id: unknown): (typeof campaigns)[number] | undefined {
  return campaigns.find((c) => c.id === id);
}

function orderById(id: unknown): (typeof orders)[number] | undefined {
  return orders.find((o) => o.id === id);
}

const INVALID_LINK = (): MockResult =>
  error(
    404,
    'INVALID_LINK',
    'Dieser Link ist ungültig. Bitte verwende den vollständigen Link aus deiner E-Mail.'
  );
const CLOSED = (): MockResult =>
  error(
    403,
    'CLOSED',
    'Der Bestellzeitraum ist geschlossen oder deine Bestellung wird bereits bearbeitet.'
  );
const SAMMEL_CONFLICT = (): MockResult =>
  error(
    409,
    'CONFLICT',
    'Die Bestellung wurde inzwischen geändert. Bitte neu laden und erneut versuchen.'
  );

function memberView(order: (typeof orders)[number]): MockResult {
  const campaign = campaignById(order.campaignId);
  if (!campaign) return INVALID_LINK();
  return json({ campaign, order, canEdit: isOpen(campaign) && order.status === 'Eingereicht' });
}

route('POST', '/api/sammelbestellungen/campaign', (req) => {
  const campaign = campaignById(req.json?.id);
  if (!campaign || !str(req.json?.token)) return INVALID_LINK();
  return isOpen(campaign) ? json(campaign) : CLOSED();
});

route('POST', '/api/sammelbestellungen/request-link', (req) => {
  const campaign = campaignById(req.json?.id);
  if (!campaign) return INVALID_LINK();
  if (!isOpen(campaign)) return CLOSED();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(req.json?.email)))
    return error(400, 'INVALID', 'Bitte gib eine gültige E-Mail-Adresse an.', {
      email: 'Bitte gib eine gültige E-Mail-Adresse an.',
    });
  if (typeof req.json?.altcha !== 'string') return CAPTCHA_FAILED();
  return json({ sent: true });
});

route(['POST', 'PUT'], '/api/sammelbestellungen/order', (req) => {
  const order = orderById(req.json?.id);
  if (!order || !str(req.json?.token)) return INVALID_LINK();
  if (req.method === 'POST') return memberView(order);
  const campaign = campaignById(order.campaignId);
  if (!campaign || !isOpen(campaign) || order.status !== 'Eingereicht') return CLOSED();
  if (req.json?.etag !== order.etag) return SAMMEL_CONFLICT();
  const body = req.json ?? {};
  order.name = str(body.name, order.name);
  order.notes = str(body.notes, order.notes);
  if (Array.isArray(body.items)) order.items = body.items as typeof order.items;
  order.submitted = true;
  order.totalCents = null;
  order.paid = false;
  touchOrder(order);
  return json({ confirmationMailSent: true });
});

route('POST', '/api/sammelbestellungen/product', (req) => {
  const order = orderById(req.json?.id);
  if (!order) return INVALID_LINK();
  return json(productInfo(str(req.json?.reference)));
});

const SAMMEL_STAFF = '/api/intern/pflege/sammelbestellungen';

route(['GET', 'POST'], SAMMEL_STAFF, (req) => {
  if (req.method === 'GET') return json(campaigns);
  if (!str(req.json?.title).trim())
    return error(400, 'INVALID', 'Bitte gib einen Titel an.', {
      title: 'Bitte gib einen Titel an.',
    });
  return json({ id: createCampaign(req.json ?? {}).id }, 201);
});

route('POST', `${SAMMEL_STAFF}/product`, (req) => json(productInfo(str(req.json?.reference))));

route('PATCH', `${SAMMEL_STAFF}/orders/:id`, (req) => {
  const order = orderById(req.params.id);
  if (!order) return notFound();
  if (req.json?.etag !== order.etag) return SAMMEL_CONFLICT();
  const body = req.json ?? {};
  const status = str(body.status, order.status);
  if (['Eingereicht', 'Bestellt', 'Eingetroffen', 'Storniert'].includes(status))
    order.status = status as typeof order.status;
  order.paid = body.paid === true;
  order.delivered = body.delivered === true;
  order.totalCents = typeof body.totalCents === 'number' ? body.totalCents : null;
  touchOrder(order);
  return noContent();
});

route('PATCH', `${SAMMEL_STAFF}/orders/:id/item`, (req) => {
  const order = orderById(req.params.id);
  if (!order) return notFound();
  if (req.json?.etag !== order.etag) return SAMMEL_CONFLICT();
  const index = Number(req.json?.index);
  const item = order.items[index];
  if (!item)
    return error(400, 'INVALID', 'Bitte wähle einen Artikel.', {
      form: 'Bitte wähle einen Artikel.',
    });
  order.items = order.items.map((it, i) => {
    if (i !== index) return it;
    const rest = { ...it };
    delete rest.excluded;
    return req.json?.excluded === true
      ? { ...rest, excluded: { reason: str(req.json?.reason) } }
      : rest;
  });
  order.totalCents = null;
  order.paid = false;
  touchOrder(order);
  return json({ confirmationMailSent: true });
});

route('POST', `${SAMMEL_STAFF}/orders/:id/message`, (req) => {
  const order = orderById(req.params.id);
  if (!order) return notFound();
  if (req.json?.etag !== undefined && req.json.etag !== order.etag) return SAMMEL_CONFLICT();
  return noContent();
});

route('POST', `${SAMMEL_STAFF}/:id/invite`, (req) => {
  const campaign = campaignById(req.params.id);
  if (!campaign) return notFound();
  if (!isOpen(campaign))
    return error(
      400,
      'INVALID',
      'Nur aktuell offene Sammelbestellungen können freigegeben werden.',
      {
        form: 'Nur aktuell offene Sammelbestellungen können freigegeben werden.',
      }
    );
  const state = invitations.get(campaign.id);
  if (req.json?.action === 'preview') {
    const total = state?.total ?? 87;
    const sent = state?.sent ?? 0;
    return json({
      total,
      pending: total - sent,
      sent,
      uncertain: 0,
      started: !!state,
      version: String(state?.version ?? 0),
    });
  }
  const next = state ?? { total: 87, sent: 0, version: 0 };
  next.sent = Math.min(next.total, next.sent + 25);
  next.version++;
  invitations.set(campaign.id, next);
  return json({
    total: next.total,
    pending: next.total - next.sent,
    sent: next.sent,
    uncertain: next.sent === next.total ? 1 : 0,
    started: true,
    version: String(next.version),
  });
});

route(['GET', 'PATCH'], `${SAMMEL_STAFF}/:id`, (req) => {
  const campaign = campaignById(req.params.id);
  if (!campaign) return notFound();
  if (req.method === 'PATCH') {
    if (req.json?.etag !== campaign.etag) return SAMMEL_CONFLICT();
    if (typeof req.json?.archived === 'boolean') campaign.archived = req.json.archived;
    touchCampaign(campaign);
    return noContent();
  }
  return json({
    campaign,
    invitationUrl: `http://${req.headers.host ?? 'localhost:4321'}/mitgliederbereich/sammelbestellungen#kind=campaign&id=${campaign.id}&token=mock`,
    orders: orders.filter((o) => o.campaignId === campaign.id),
  });
});
