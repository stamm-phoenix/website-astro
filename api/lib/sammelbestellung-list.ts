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
import { validateSammelCatalog, validateSammelItems } from './sammelbestellung-validation';
import { parseSammelPayment, parseSammelPaymentEvents } from './sammelbestellung-payment-storage';
import type { SammelPaymentRecord, SammelPaymentEvent } from './sammelbestellung-payment-model';

/** Identifies corrupt persisted data without substituting an apparently empty order. */
export class InvalidSammelDataError extends Error {
  constructor(rowId: string, field: string) {
    super(
      `SharePoint-Eintrag ${rowId}: Das Feld ${field} enthält ungültige Daten. Bitte das Feld in der SharePoint-Liste korrigieren lassen.`
    );
    this.name = 'InvalidSammelDataError';
  }
}

export interface OrderRow extends SammelBestellung {
  linkSentAt: string;
  paymentRecord: SammelPaymentRecord | null;
  paymentEvents: SammelPaymentEvent[];
}

/** Returns the configured SharePoint campaign list ID. */
function campaignsList(): string {
  return getEnvironment(EnvironmentVariable.SHAREPOINT_SAMMELBESTELLUNGEN_LIST_ID);
}
/** Returns the configured SharePoint order list ID. */
function ordersList(): string {
  return getEnvironment(EnvironmentVariable.SHAREPOINT_SAMMELBESTELLUNGEN_ORDERS_LIST_ID);
}

/** Extracts a numeric SharePoint row ID, loaded ETag and field values. */
function fields(raw: unknown): { id: string; etag: string; data: Record<string, unknown> } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new InvalidSammelDataError('?', 'Eintrag');
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || !/^\d+$/.test(row.id))
    throw new InvalidSammelDataError(String(row.id ?? '?'), 'id');
  if (!row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields))
    throw new InvalidSammelDataError(row.id, 'fields');
  return {
    id: row.id,
    etag: typeof row.eTag === 'string' ? row.eTag : '',
    data: row.fields as Record<string, unknown>,
  };
}

/** Reads optional SharePoint text, treating absent values as blank. */
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
/** Validates stored JSON with the same schema used when writing; empty arrays remain explicit. */
function parseJson<T>(
  value: unknown,
  rowId: string,
  field: string,
  validate: (value: unknown) => T
): T {
  try {
    if (typeof value !== 'string') throw new Error('Missing JSON');
    return validate(JSON.parse(value));
  } catch {
    throw new InvalidSammelDataError(rowId, field);
  }
}

/** Maps a SharePoint campaign and validates its persisted catalog. */
function campaign(raw: unknown): SammelAktion {
  const row = fields(raw);
  return {
    id: row.id,
    etag: row.etag,
    title: str(row.data.Title),
    description: str(row.data.Beschreibung),
    startsAt: str(row.data.Beginn),
    endsAt: str(row.data.Ende),
    catalog: parseJson(row.data.Katalog, row.id, 'Katalog', validateSammelCatalog),
    archived: row.data.Archiviert === true,
  };
}
/** Maps an order with validated items and its private mail cooldown metadata. */
function order(raw: unknown): OrderRow {
  const row = fields(raw);
  const status = row.data.Status;
  if (!SAMMEL_STATUS.includes(status as SammelBestellung['status']))
    throw new InvalidSammelDataError(row.id, 'Status');
  const paymentRecord =
    row.data.CampflowZahlung == null || row.data.CampflowZahlung === ''
      ? null
      : parseJson(row.data.CampflowZahlung, row.id, 'CampflowZahlung', parseSammelPayment);
  const paymentEvents =
    row.data.CampflowZahlungsprotokoll == null || row.data.CampflowZahlungsprotokoll === ''
      ? []
      : parseJson(
          row.data.CampflowZahlungsprotokoll,
          row.id,
          'CampflowZahlungsprotokoll',
          parseSammelPaymentEvents
        );
  const op = paymentRecord?.operation;
  if (
    op &&
    (op.snapshot.orderId !== row.id ||
      op.snapshot.campaignId !== str(row.data.AktionId) ||
      op.snapshot.amount !== row.data.BetragCent ||
      str(row.data.CampflowBeitragId) !== (op.contribution?.id ?? ''))
  )
    throw new InvalidSammelDataError(row.id, 'CampflowZahlung');
  if (!op && str(row.data.CampflowBeitragId))
    throw new InvalidSammelDataError(row.id, 'CampflowBeitragId');
  if (paymentRecord && !paymentEvents.length)
    throw new InvalidSammelDataError(row.id, 'CampflowZahlungsprotokoll');
  if (!paymentRecord && paymentEvents.length)
    throw new InvalidSammelDataError(row.id, 'CampflowZahlung');
  if (paymentRecord?.settlement && paymentRecord.settlement.paid !== (row.data.Bezahlt === true))
    throw new InvalidSammelDataError(row.id, 'Bezahlt');
  return {
    id: row.id,
    etag: row.etag,
    campaignId: str(row.data.AktionId),
    name: str(row.data.Title),
    email: str(row.data.Email),
    items: parseJson(row.data.Artikel, row.id, 'Artikel', (value) => {
      if (Array.isArray(value) && value.length === 0 && row.data.Eingereicht !== true) return [];
      return validateSammelItems(value);
    }),
    notes: str(row.data.Bemerkungen),
    status: status as SammelBestellung['status'],
    submitted: row.data.Eingereicht === true,
    paid: row.data.Bezahlt === true,
    delivered: row.data.Ausgeliefert === true,
    totalCents: typeof row.data.BetragCent === 'number' ? row.data.BetragCent : null,
    linkSentAt: str(row.data.LinkGesendetAm),
    paymentRecord,
    paymentEvents,
    ...(op
      ? {
          payment: {
            locked: true,
            state: op.state,
            reference: op.contribution?.reference ?? null,
            requestSentAt: paymentRecord?.dispatch?.confirmedAt ?? null,
            paymentMarkedAt: paymentRecord?.settlement?.markedAt ?? null,
          },
        }
      : {}),
  };
}

/** Loads all campaigns, failing visibly if a stored catalog is corrupt. */
export async function getSammelCampaigns(): Promise<SammelAktion[]> {
  return (await getSharePointListItems(campaignsList(), { expand: 'fields' })).map(campaign);
}
/** Loads a numeric campaign ID or returns undefined when it is absent. */
export async function getSammelCampaign(id: string): Promise<SammelAktion | undefined> {
  if (!/^\d+$/.test(id)) return undefined;
  const row = await getSharePointListItem(campaignsList(), id);
  return row ? campaign(row) : undefined;
}
/** Creates a campaign once per unique CreationKey and adopts concurrent retry results. */
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
      Archiviert: false,
    });
  } catch (error: unknown) {
    if ([400, 409].includes(getGraphStatus(error) ?? 0)) {
      const winner = await find();
      if (winner) return winner;
    }
    throw error;
  }
}
/** Loads every order for a campaign without discarding invalid article data. */
export async function getSammelOrders(campaignId: string): Promise<OrderRow[]> {
  return (
    await getSharePointListItems(ordersList(), {
      expand: 'fields',
      filter: `fields/AktionId eq '${campaignId}'`,
    })
  ).map(order);
}
/** Loads one numeric order ID, including its loaded version and mail cooldown. */
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
/** Checks a domain-specific HMAC token in constant time after validating its encoding. */
export function verifySammelToken(kind: 'campaign' | 'order', id: string, value: unknown): boolean {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const actual = Buffer.from(value);
  const expected = Buffer.from(sammelToken(kind, id));
  return timingSafeEqual(actual, expected);
}
/** Builds a personal or invitation link with the token confined to the URL fragment. */
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

/** Writes order fields only against a concrete loaded ETag, never a wildcard. */
export async function updateSammelOrder(
  id: string,
  values: Record<string, unknown>,
  etag: string
): Promise<void> {
  if (!etag || etag === '*') throw new Error('A concrete ETag is required');
  await updateSharePointListItem(ordersList(), id, values, etag);
}

/** Archives or restores a campaign using its loaded ETag. */
export async function setSammelCampaignArchived(
  id: string,
  archived: boolean,
  etag: string
): Promise<void> {
  if (!etag || etag === '*') throw new Error('A concrete ETag is required');
  await updateSharePointListItem(campaignsList(), id, { Archiviert: archived }, etag);
}

/** Removes private link-send metadata from an order API response. */
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
    ...(row.payment ? { payment: row.payment } : {}),
  };
}
