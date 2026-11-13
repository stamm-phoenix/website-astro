import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import { EnvironmentVariable, getEnvironment } from './environment';
import {
  getDb,
  inTransaction,
  parseId,
  toVersion,
  VersionConflictError,
  requireRowversion,
} from './db';
import type { Db } from './db';
import type {
  SammelOrderItemTable,
  SammelOrderTable,
  SammelPaymentEventTable,
  SammelPaymentTable,
} from './db-schema-sammel';
import { SAMMEL_STATUS } from './sammelbestellung-model';
import type { SammelAktion, SammelBestellung } from './sammelbestellung-model';
import { groupBy, loadOrderRows } from './sammelbestellung-rows';
import type { OrderFilter } from './sammelbestellung-rows';
import { validateSammelCatalog, validateSammelItems } from './sammelbestellung-validation';
import { parseSammelPaymentEvents } from './sammelbestellung-payment-storage';
import {
  InvalidSammelDataError,
  isSammelDuplicate,
  validStored,
  time,
  iso,
} from './sammelbestellung-list-basis';
import type { OrderRow, SammelOrderChanges } from './sammelbestellung-list-basis';
import {
  insertSammelCatalog,
  replaceSammelItems,
  replaceSammelPayment,
  insertSammelEvent,
  paymentRecord,
} from './sammelbestellung-list-zeilen';

/** One campaign by its ID, or the campaign of an order by the order's ID. */
type CampaignFilter = { id: number } | { orderId: number };

async function loadCampaigns(db: Db, filter?: CampaignFilter): Promise<SammelAktion[]> {
  let campaigns = db.selectFrom('sammel.campaign').selectAll().orderBy('id');
  let items = db
    .selectFrom('sammel.catalog_item')
    .selectAll()
    .orderBy('campaign_id')
    .orderBy('position');
  let variants = db
    .selectFrom('sammel.catalog_variant')
    .selectAll()
    .orderBy('campaign_id')
    .orderBy('item_position')
    .orderBy('position');
  if (filter !== undefined) {
    const id =
      'id' in filter
        ? filter.id
        : db
            .selectFrom('sammel.member_order')
            .select('campaign_id')
            .where('id', '=', filter.orderId);
    campaigns = campaigns.where('id', '=', id);
    items = items.where('campaign_id', '=', id);
    variants = variants.where('campaign_id', '=', id);
  }
  const [rows, catalog, variantRows] = await Promise.all([
    campaigns.execute(),
    items.execute(),
    variants.execute(),
  ]);
  const byCampaign = groupBy(catalog, 'campaign_id');
  const variantsOf = new Map<string, string[]>();
  for (const row of variantRows) {
    const key = `${row.campaign_id}:${row.item_position}`;
    const variantList = variantsOf.get(key);
    if (variantList) variantList.push(row.variant);
    else variantsOf.set(key, [row.variant]);
  }
  return rows.map((row) => ({
    id: String(row.id),
    etag: toVersion(row.version),
    title: row.title,
    description: row.description,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    catalog: validStored(row.id, 'Katalog', () =>
      validateSammelCatalog(
        (byCampaign.get(row.id) ?? []).map((item) => ({
          shop: item.shop,
          name: item.name,
          reference: item.reference,
          variants: variantsOf.get(`${item.campaign_id}:${item.position}`) ?? [],
        }))
      )
    ),
    archived: row.archived,
  }));
}

/** Loads all campaigns, failing visibly if a stored catalog is corrupt. */
export async function getSammelCampaigns(): Promise<SammelAktion[]> {
  return loadCampaigns(getDb());
}
/** Loads a numeric campaign ID or returns undefined when it is absent. */
export async function getSammelCampaign(id: string): Promise<SammelAktion | undefined> {
  const campaignId = parseId(id);
  if (campaignId === undefined) return undefined;
  return (await loadCampaigns(getDb(), { id: campaignId }))[0];
}
/**
 * Loads the campaign of an order by the order's ID, so it can be read together with the order
 * instead of after it.
 */
export async function getSammelOrderCampaign(orderId: string): Promise<SammelAktion | undefined> {
  const id = parseId(orderId);
  if (id === undefined) return undefined;
  return (await loadCampaigns(getDb(), { orderId: id }))[0];
}

async function campaignByKey(creationKey: string): Promise<string | undefined> {
  const row = await getDb()
    .selectFrom('sammel.campaign')
    .select('id')
    .where('creation_key', '=', creationKey)
    .executeTakeFirst();
  return row ? String(row.id) : undefined;
}

/** Creates a campaign once per unique creation key and adopts concurrent retry results. */
export async function createSammelCampaign(
  input: Omit<SammelAktion, 'id' | 'etag'>,
  creationKey: string
): Promise<string> {
  const existing = await campaignByKey(creationKey);
  if (existing) return existing;
  try {
    return await inTransaction(async (trx) => {
      const { id } = await trx
        .insertInto('sammel.campaign')
        .values({
          creation_key: creationKey,
          title: input.title,
          description: input.description,
          starts_at: time(input.startsAt),
          ends_at: time(input.endsAt),
          archived: false,
        })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      await insertSammelCatalog(trx, id, input.catalog);
      return String(id);
    });
  } catch (error: unknown) {
    if (isSammelDuplicate(error)) {
      const winner = await campaignByKey(creationKey);
      if (winner) return winner;
    }
    throw error;
  }
}

async function loadOrders(db: Db, filter: OrderFilter): Promise<OrderRow[]> {
  const { orders, items, payments, emails, events } = await loadOrderRows(db, filter);
  const itemsByOrder = groupBy(items, 'order_id');
  const paymentByOrder = new Map(payments.map((row) => [row.order_id, row]));
  const emailsByOrder = groupBy(emails, 'order_id');
  const eventsByOrder = groupBy(events, 'order_id');
  return orders.map((row) =>
    order(
      row,
      itemsByOrder.get(row.id) ?? [],
      paymentByOrder.get(row.id),
      (emailsByOrder.get(row.id) ?? []).map((entry) => entry.email),
      eventsByOrder.get(row.id) ?? []
    )
  );
}

/** Maps an order with validated items, payment record and audit history. */
function order(
  row: Selectable<SammelOrderTable>,
  items: Selectable<SammelOrderItemTable>[],
  payment: Selectable<SammelPaymentTable> | undefined,
  emails: string[],
  events: Selectable<SammelPaymentEventTable>[]
): OrderRow {
  const id = String(row.id);
  if (!SAMMEL_STATUS.includes(row.status)) throw new InvalidSammelDataError(id, 'Status');
  const record = payment ? validStored(id, 'Zahlung', () => paymentRecord(payment, emails)) : null;
  const history = validStored(id, 'Zahlungsprotokoll', () =>
    parseSammelPaymentEvents(
      events.map((event) => ({
        at: iso(event.at),
        actor: { id: event.actor_id, name: event.actor_name },
        action: event.action,
        operationKey: event.operation_key,
        evidence: event.evidence,
      }))
    )
  );
  const op = record?.operation;
  if (
    op &&
    (op.snapshot.orderId !== id ||
      op.snapshot.campaignId !== String(row.campaign_id) ||
      op.snapshot.amount !== row.total_cents)
  )
    throw new InvalidSammelDataError(id, 'Zahlung');
  if (record && !history.length) throw new InvalidSammelDataError(id, 'Zahlungsprotokoll');
  if (!record && history.length) throw new InvalidSammelDataError(id, 'Zahlung');
  if (record?.settlement && record.settlement.paid !== row.paid)
    throw new InvalidSammelDataError(id, 'Bezahlt');
  return {
    id,
    etag: toVersion(row.version),
    campaignId: String(row.campaign_id),
    name: row.name,
    email: row.email,
    items: validStored(id, 'Artikel', () =>
      items.length === 0 && !row.submitted
        ? []
        : validateSammelItems(
            items.map((item) => ({
              shop: item.shop,
              ...(item.excluded ? { excluded: { reason: item.excluded_reason } } : {}),
              name: item.name,
              reference: item.reference,
              variant: item.variant,
              quantity: item.quantity,
            }))
          )
    ),
    notes: row.notes,
    status: row.status,
    submitted: row.submitted,
    paid: row.paid,
    delivered: row.delivered,
    totalCents: row.total_cents,
    linkSentAt: iso(row.link_sent_at) ?? '',
    paymentRecord: record,
    paymentEvents: history,
    ...(op
      ? {
          payment: {
            locked: true,
            state: op.state,
            reference: op.contribution?.reference ?? null,
            requestSentAt: record?.dispatch?.confirmedAt ?? null,
            paymentMarkedAt: record?.settlement?.markedAt ?? null,
          },
        }
      : {}),
  };
}

/** Loads every order for a campaign without discarding invalid article data. */
export async function getSammelOrders(campaignId: string): Promise<OrderRow[]> {
  const id = parseId(campaignId);
  return id === undefined ? [] : loadOrders(getDb(), { campaignId: id });
}
/** Loads one numeric order ID, including its loaded version and mail cooldown. */
export async function getSammelOrder(id: string): Promise<OrderRow | undefined> {
  const orderId = parseId(id);
  if (orderId === undefined) return undefined;
  return (await loadOrders(getDb(), { id: orderId }))[0];
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
export function sammelUrl(siteUrl: string, kind: 'campaign' | 'order', id: string): string {
  const params = new URLSearchParams({ kind, id, token: sammelToken(kind, id) });
  return `${siteUrl}/mitgliederbereich/sammelbestellungen#${params}`;
}

/** One order per campaign and address: the unique key decides concurrent creation. */
export async function ensureSammelOrder(campaignId: string, email: string): Promise<OrderRow> {
  const id = parseId(campaignId);
  if (id === undefined) throw new Error('Invalid campaign ID');
  // The column compares exactly (0022); checking again keeps another address's order out
  const find = async (): Promise<OrderRow | undefined> =>
    (await loadOrders(getDb(), { campaignId: id, email })).find((row) => row.email === email);
  const existing = await find();
  if (existing) return existing;
  try {
    await getDb().insertInto('sammel.member_order').values({ campaign_id: id, email }).execute();
  } catch (error: unknown) {
    if (!isSammelDuplicate(error)) throw error;
  }
  const created = await find();
  if (!created) throw new Error('Created order could not be loaded');
  return created;
}

/**
 * Writes an order against its loaded version, never unconditionally. Items, payment record and
 * audit entry are written in the same transaction and change the version of the order.
 */
export async function updateSammelOrder(
  id: string,
  changes: SammelOrderChanges,
  etag: string
): Promise<void> {
  const orderId = parseId(id);
  const version = requireRowversion(etag);
  if (orderId === undefined) throw new VersionConflictError();
  await inTransaction(async (trx) => {
    const result = await trx
      .updateTable('sammel.member_order')
      .set({
        // Always one assignment, so a change of items or payment alone also gets a new version
        campaign_id: sql<number>`campaign_id`,
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
        ...(changes.status !== undefined ? { status: changes.status } : {}),
        ...(changes.submitted !== undefined ? { submitted: changes.submitted } : {}),
        ...(changes.paid !== undefined ? { paid: changes.paid } : {}),
        ...(changes.delivered !== undefined ? { delivered: changes.delivered } : {}),
        ...(changes.totalCents !== undefined ? { total_cents: changes.totalCents } : {}),
        ...(changes.linkSentAt !== undefined
          ? { link_sent_at: changes.linkSentAt ? time(changes.linkSentAt) : null }
          : {}),
      })
      .where('id', '=', orderId)
      .where('version', '=', version)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1) throw new VersionConflictError();
    if (changes.items) await replaceSammelItems(trx, orderId, changes.items);
    if (changes.payment) {
      await replaceSammelPayment(trx, orderId, changes.payment.record);
      await insertSammelEvent(trx, orderId, changes.payment.event);
    }
  });
}

/** Archives or restores a campaign using its loaded version. */
export async function setSammelCampaignArchived(
  id: string,
  archived: boolean,
  etag: string
): Promise<void> {
  const campaignId = parseId(id);
  const version = requireRowversion(etag);
  if (campaignId === undefined) throw new VersionConflictError();
  const result = await getDb()
    .updateTable('sammel.campaign')
    .set({ archived })
    .where('id', '=', campaignId)
    .where('version', '=', version)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1) throw new VersionConflictError();
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
