import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { EnvironmentVariable, getEnvironment } from './environment';
import {
  createSharePointListItem,
  getSharePointListItem,
  getSharePointListItems,
  updateSharePointListItem,
  getGraphStatus,
} from './sharepoint-data-access';
import { SAMMEL_STATUS } from './sammelbestellung-model';
import type { SammelAktion, SammelBestellung } from './sammelbestellung-model';
import { object } from './sammelbestellung-validation';

interface OrderRow extends SammelBestellung {
  linkSentAt: string;
}

function campaignsList(): string {
  return getEnvironment(EnvironmentVariable.SHAREPOINT_SAMMELBESTELLUNGEN_LIST_ID);
}
function ordersList(): string {
  return getEnvironment(EnvironmentVariable.SHAREPOINT_SAMMELBESTELLUNGEN_ORDERS_LIST_ID);
}

function fields(raw: unknown): { id: string; etag: string; data: Record<string, unknown> } {
  const row = object(raw);
  if (typeof row.id !== 'string' || !/^\d+$/.test(row.id))
    throw new Error('Invalid SharePoint item');
  return {
    id: row.id,
    etag: typeof row.eTag === 'string' ? row.eTag : '',
    data: object(row.fields),
  };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function parseJson(value: unknown): unknown {
  return JSON.parse(str(value) || '[]');
}

function campaign(raw: unknown): SammelAktion {
  const row = fields(raw);
  return {
    id: row.id,
    etag: row.etag,
    title: str(row.data.Title),
    description: str(row.data.Beschreibung),
    startsAt: str(row.data.Beginn),
    endsAt: str(row.data.Ende),
    catalog: parseJson(row.data.Katalog) as SammelAktion['catalog'],
  };
}
function order(raw: unknown): OrderRow {
  const row = fields(raw);
  const status = row.data.Status;
  if (!SAMMEL_STATUS.includes(status as SammelBestellung['status']))
    throw new Error('Invalid order status');
  return {
    id: row.id,
    etag: row.etag,
    campaignId: str(row.data.AktionId),
    name: str(row.data.Title),
    email: str(row.data.Email),
    items: parseJson(row.data.Artikel) as SammelBestellung['items'],
    notes: str(row.data.Bemerkungen),
    status: status as SammelBestellung['status'],
    submitted: row.data.Eingereicht === true,
    paid: row.data.Bezahlt === true,
    delivered: row.data.Ausgeliefert === true,
    totalCents: typeof row.data.BetragCent === 'number' ? row.data.BetragCent : null,
    linkSentAt: str(row.data.LinkGesendetAm),
  };
}

export async function getSammelCampaigns(): Promise<SammelAktion[]> {
  return (await getSharePointListItems(campaignsList(), { expand: 'fields' })).map(campaign);
}
export async function getSammelCampaign(id: string): Promise<SammelAktion | undefined> {
  if (!/^\d+$/.test(id)) return undefined;
  const row = await getSharePointListItem(campaignsList(), id);
  return row ? campaign(row) : undefined;
}
export async function createSammelCampaign(
  input: Omit<SammelAktion, 'id' | 'etag'>,
  creationKey: string
): Promise<string> {
  const find = async (): Promise<string | undefined> => {
    const rows = await getSharePointListItems(campaignsList(), {
      expand: 'fields',
      filter: `fields/CreationKey eq '${creationKey}'`,
    });
    return rows.length ? campaign(rows[0]).id : undefined;
  };
  const existing = await find();
  if (existing) return existing;
  try {
    return await createSharePointListItem(campaignsList(), {
      CreationKey: creationKey,
      Title: input.title,
      Beschreibung: input.description,
      Beginn: input.startsAt,
      Ende: input.endsAt,
      Katalog: JSON.stringify(input.catalog),
    });
  } catch (error: unknown) {
    if ([400, 409].includes(getGraphStatus(error) ?? 0)) {
      const winner = await find();
      if (winner) return winner;
    }
    throw error;
  }
}
export async function getSammelOrders(campaignId: string): Promise<OrderRow[]> {
  return (
    await getSharePointListItems(ordersList(), {
      expand: 'fields',
      filter: `fields/AktionId eq '${campaignId}'`,
    })
  ).map(order);
}
export async function getSammelOrder(id: string): Promise<OrderRow | undefined> {
  if (!/^\d+$/.test(id)) return undefined;
  const row = await getSharePointListItem(ordersList(), id);
  return row ? order(row) : undefined;
}

/** Domain-separated, reproducible private links allow mail retries without invalidating old links. */
export function sammelToken(kind: 'campaign' | 'order', id: string): string {
  const secret = getEnvironment(EnvironmentVariable.SAMMELBESTELLUNG_LINK_SECRET);
  if (secret.length < 32)
    throw new Error('SAMMELBESTELLUNG_LINK_SECRET must contain at least 32 characters');
  return createHmac('sha256', secret).update(`sammelbestellung:${kind}:${id}`).digest('base64url');
}
export function verifySammelToken(kind: 'campaign' | 'order', id: string, value: unknown): boolean {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(sammelToken(kind, id));
  return timingSafeEqual(actual, expected);
}
export function sammelUrl(kind: 'campaign' | 'order', id: string): string {
  const base = getEnvironment(EnvironmentVariable.SITE_URL).replace(/\/+$/, '');
  const params = new URLSearchParams({ kind, id, token: sammelToken(kind, id) });
  return `${base}/mitgliederbereich/sammelbestellungen#${params}`;
}

/** OrderKey must be a SharePoint unique column: the database decides concurrent creation. */
export async function ensureSammelOrder(campaignId: string, email: string): Promise<OrderRow> {
  const key = `${campaignId}:${createHash('sha256').update(email).digest('hex')}`;
  const find = async (): Promise<OrderRow | undefined> => {
    const rows = await getSharePointListItems(ordersList(), {
      expand: 'fields',
      filter: `fields/OrderKey eq '${key}'`,
    });
    return rows.length ? order(rows[0]) : undefined;
  };
  const existing = await find();
  if (existing) return existing;
  try {
    const id = await createSharePointListItem(ordersList(), {
      Title: '',
      Email: email,
      AktionId: campaignId,
      OrderKey: key,
      Artikel: '[]',
      Status: 'Eingereicht',
      Eingereicht: false,
      Bezahlt: false,
      Ausgeliefert: false,
    });
    const created = await getSammelOrder(id);
    if (!created) throw new Error('Created order could not be loaded');
    return created;
  } catch (error: unknown) {
    // A duplicate unique field can surface as 400 or 409 in Graph. Adopt only an actual match.
    if ([400, 409].includes(getGraphStatus(error) ?? 0)) {
      const winner = await find();
      if (winner) return winner;
    }
    throw error;
  }
}

export async function updateSammelOrder(
  id: string,
  values: Record<string, unknown>,
  etag: string
): Promise<void> {
  if (!etag || etag === '*') throw new Error('A concrete ETag is required');
  await updateSharePointListItem(ordersList(), id, values, etag);
}

export function publicSammelOrder(row: OrderRow): SammelBestellung {
  return {
    id: row.id,
    etag: row.etag,
    campaignId: row.campaignId,
    name: row.name,
    email: row.email,
    items: row.items,
    notes: row.notes,
    status: row.status,
    submitted: row.submitted,
    paid: row.paid,
    delivered: row.delivered,
    totalCents: row.totalCents,
  };
}
