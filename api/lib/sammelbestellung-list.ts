import { HELP_CONTACTS } from './help-contacts';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import type { Insertable, Selectable, Transaction } from 'kysely';
import { EnvironmentVariable, getEnvironment } from './environment';
import {
  getDb,
  getSqlErrorNumber,
  inTransaction,
  parseId,
  requireVersion,
  toVersion,
  VersionConflictError,
} from './db';
import type { Db } from './db';
import type { Database } from './db-schema';
import type {
  SammelOrderItemTable,
  SammelOrderTable,
  SammelPaymentEventTable,
  SammelPaymentTable,
} from './db-schema';
import { SAMMEL_STATUS } from './sammelbestellung-model';
import type {
  SammelAktion,
  SammelArtikel,
  SammelBestellung,
  SammelKatalogArtikel,
  SammelStatus,
} from './sammelbestellung-model';
import { validateSammelCatalog, validateSammelItems } from './sammelbestellung-validation';
import { parseSammelPayment, parseSammelPaymentEvents } from './sammelbestellung-payment-storage';
import type { SammelPaymentRecord, SammelPaymentEvent } from './sammelbestellung-payment-model';

/** Identifies corrupt persisted data without substituting an apparently empty order. */
export class InvalidSammelDataError extends Error {
  constructor(rowId: string, field: string) {
    super(
      `Eintrag ${rowId}: Das Feld ${field} enthält ungültige Daten. Bitte wende dich an ${HELP_CONTACTS.technik}.`
    );
    this.name = 'InvalidSammelDataError';
  }
}

export interface OrderRow extends SammelBestellung {
  linkSentAt: string;
  paymentRecord: SammelPaymentRecord | null;
  paymentEvents: SammelPaymentEvent[];
}

/** Changes to an order; `payment` replaces the payment record and appends one audit entry. */
export interface SammelOrderChanges {
  name?: string;
  notes?: string;
  items?: SammelArtikel[];
  status?: SammelStatus;
  submitted?: boolean;
  paid?: boolean;
  delivered?: boolean;
  totalCents?: number | null;
  linkSentAt?: string | null;
  payment?: { record: SammelPaymentRecord; event: SammelPaymentEvent };
}

/** SQL Server reports a duplicate key as 2627 (constraint) or 2601 (unique index). */
export function isSammelDuplicate(error: unknown): boolean {
  const number = getSqlErrorNumber(error);
  return number === 2627 || number === 2601;
}

/** Runs the stored value through the same validation as an input, so corrupt rows fail visibly. */
function validStored<T>(rowId: number | string, field: string, read: () => T): T {
  try {
    return read();
  } catch {
    throw new InvalidSammelDataError(String(rowId), field);
  }
}

/** A timestamp for a `datetime2(3)` column. */
function time(value: string): string {
  return new Date(value).toISOString();
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** Validated rows omit Rüsthaus, the default supplier; the table names it explicitly. */
function storedShop(row: { shop?: SammelArtikel['shop'] }): SammelArtikel['shop'] & string {
  return row.shop ?? 'ruesthaus';
}

/** Stores the catalog of a new campaign: one row per article and per variant. */
export async function insertSammelCatalog(
  trx: Transaction<Database>,
  campaignId: number,
  catalog: SammelKatalogArtikel[]
): Promise<void> {
  if (!catalog.length) return;
  await trx
    .insertInto('sammel.catalog_item')
    .values(
      catalog.map((article, position) => ({
        campaign_id: campaignId,
        position,
        shop: storedShop(article),
        name: article.name,
        reference: article.reference,
      }))
    )
    .execute();
  const variants = catalog.flatMap((article, item) =>
    article.variants.map((variant, position) => ({
      campaign_id: campaignId,
      item_position: item,
      position,
      variant,
    }))
  );
  // SQL Server takes at most 2100 parameters per statement
  for (let index = 0; index < variants.length; index += 500)
    await trx
      .insertInto('sammel.catalog_variant')
      .values(variants.slice(index, index + 500))
      .execute();
}

/** Replaces the articles of an order. */
export async function replaceSammelItems(
  trx: Transaction<Database>,
  orderId: number,
  items: SammelArtikel[]
): Promise<void> {
  await trx.deleteFrom('sammel.order_item').where('order_id', '=', orderId).execute();
  if (!items.length) return;
  await trx
    .insertInto('sammel.order_item')
    .values(
      items.map((item, position) => ({
        order_id: orderId,
        position,
        shop: storedShop(item),
        name: item.name,
        reference: item.reference,
        variant: item.variant,
        quantity: item.quantity,
        excluded: item.excluded !== undefined,
        excluded_reason: item.excluded?.reason ?? '',
      }))
    )
    .execute();
}

/** Replaces the payment record of an order, including the contact addresses of the person. */
export async function replaceSammelPayment(
  trx: Transaction<Database>,
  orderId: number,
  record: SammelPaymentRecord
): Promise<void> {
  await trx.deleteFrom('sammel.payment_email').where('order_id', '=', orderId).execute();
  await trx.deleteFrom('sammel.payment').where('order_id', '=', orderId).execute();
  await trx.insertInto('sammel.payment').values(sammelPaymentRow(orderId, record)).execute();
  const emails = record.assignment.person.emails;
  if (emails.length)
    await trx
      .insertInto('sammel.payment_email')
      .values(emails.map((email, position) => ({ order_id: orderId, position, email })))
      .execute();
}

/** Appends one entry to the payment history; entries are never changed. */
export async function insertSammelEvent(
  trx: Transaction<Database>,
  orderId: number,
  event: SammelPaymentEvent
): Promise<void> {
  await trx
    .insertInto('sammel.payment_event')
    .values({
      order_id: orderId,
      at: time(event.at),
      actor_id: event.actor.id,
      actor_name: event.actor.name,
      action: event.action,
      operation_key: event.operationKey,
      evidence: event.evidence,
    })
    .execute();
}

/** The columns of a payment record; the snapshot IDs are the ones stored at preparation. */
function sammelPaymentRow(
  orderId: number,
  record: SammelPaymentRecord
): Insertable<SammelPaymentTable> {
  const { assignment, operation: op, dispatch, settlement } = record;
  const expense = op?.snapshot.attachedExpense;
  return {
    order_id: orderId,
    person_id: assignment.person.id,
    person_name: assignment.person.name,
    person_matches_email: assignment.person.matchesEmail,
    assignment_reason: assignment.reason,
    assigned_by_id: assignment.confirmedBy.id,
    assigned_by_name: assignment.confirmedBy.name,
    assigned_at: time(assignment.confirmedAt),
    operation_key: op?.key ?? null,
    operation_hash: op?.hash ?? null,
    operation_state: op?.state ?? null,
    operation_started_at: op ? time(op.startedAt) : null,
    operation_attempted_at: op?.attemptedAt ? time(op.attemptedAt) : null,
    snapshot_person_id: op?.snapshot.personId ?? null,
    snapshot_amount: op?.snapshot.amount ?? null,
    snapshot_description: op?.snapshot.description ?? null,
    snapshot_order_id: op ? Number(op.snapshot.orderId) : null,
    snapshot_campaign_id: op ? Number(op.snapshot.campaignId) : null,
    snapshot_revision: op?.snapshot.revision ?? null,
    snapshot_costunit_name: expense?.costunitName ?? null,
    snapshot_category_name: expense?.categoryName ?? null,
    contribution_id: op?.contribution?.id ?? null,
    contribution_reference: op?.contribution?.reference ?? null,
    error_category: op?.errorCategory ?? null,
    dispatch_confirmed_at: dispatch ? time(dispatch.confirmedAt) : null,
    dispatch_actor_id: dispatch?.actor.id ?? null,
    dispatch_actor_name: dispatch?.actor.name ?? null,
    settlement_paid: settlement?.paid ?? null,
    settlement_marked_at: settlement ? time(settlement.markedAt) : null,
    settlement_actor_id: settlement?.actor.id ?? null,
    settlement_actor_name: settlement?.actor.name ?? null,
  };
}

/** Rebuilds the stored record and validates it like the former JSON column. */
function paymentRecord(row: Selectable<SammelPaymentTable>, emails: string[]): SammelPaymentRecord {
  // Without an operation no field of one may be set, else a stored contribution would be hidden
  if (
    row.operation_key === null &&
    [
      row.operation_hash,
      row.operation_state,
      row.operation_started_at,
      row.operation_attempted_at,
      row.snapshot_person_id,
      row.snapshot_amount,
      row.snapshot_description,
      row.snapshot_order_id,
      row.snapshot_campaign_id,
      row.snapshot_revision,
      row.snapshot_costunit_name,
      row.snapshot_category_name,
      row.contribution_id,
      row.contribution_reference,
      row.error_category,
    ].some((value) => value !== null)
  )
    throw new Error('Operation fields without an operation');
  const operation =
    row.operation_key === null
      ? null
      : {
          key: row.operation_key,
          hash: row.operation_hash,
          snapshot: {
            personId: row.snapshot_person_id,
            amount: row.snapshot_amount,
            description: row.snapshot_description,
            orderId: String(row.snapshot_order_id),
            campaignId: String(row.snapshot_campaign_id),
            revision: row.snapshot_revision,
            ...(row.snapshot_costunit_name !== null
              ? {
                  attachedExpense: {
                    costunitName: row.snapshot_costunit_name,
                    categoryName: row.snapshot_category_name,
                  },
                }
              : {}),
          },
          state: row.operation_state,
          startedAt: iso(row.operation_started_at),
          attemptedAt: iso(row.operation_attempted_at),
          contribution:
            row.contribution_id === null
              ? null
              : { id: row.contribution_id, reference: row.contribution_reference },
          errorCategory: row.error_category,
        };
  return parseSammelPayment({
    version: 1,
    assignment: {
      person: {
        id: row.person_id,
        name: row.person_name,
        emails,
        matchesEmail: row.person_matches_email,
      },
      reason: row.assignment_reason,
      confirmedBy: { id: row.assigned_by_id, name: row.assigned_by_name },
      confirmedAt: iso(row.assigned_at),
    },
    operation,
    dispatch:
      row.dispatch_confirmed_at === null
        ? null
        : {
            method: 'campflow_dashboard',
            confirmedAt: iso(row.dispatch_confirmed_at),
            actor: { id: row.dispatch_actor_id, name: row.dispatch_actor_name },
          },
    settlement:
      row.settlement_marked_at === null
        ? null
        : {
            source: 'manual',
            paid: row.settlement_paid,
            markedAt: iso(row.settlement_marked_at),
            actor: { id: row.settlement_actor_id, name: row.settlement_actor_name },
          },
  });
}

function groupBy<T extends Record<K, number>, K extends string>(
  rows: T[],
  key: K
): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) groups.set(row[key], [...(groups.get(row[key]) ?? []), row]);
  return groups;
}

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
    variantsOf.set(key, [...(variantsOf.get(key) ?? []), row.variant]);
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

type OrderFilter = { id: number } | { campaignId: number; email?: string };

/**
 * Reads orders with their articles, payment and history. The statements see no common snapshot,
 * so a write committing in between could pair a new order version with an old payment state.
 * Every change of those rows also writes the order row, so the order versions are read first
 * and checked again at the end; if one changed, the whole read is repeated.
 */
async function loadOrders(db: Db, filter: OrderFilter): Promise<OrderRow[]> {
  const ids = (): ReturnType<typeof orderIds> => orderIds(db, filter);
  for (let attempt = 1; ; attempt++) {
    const orders = await db
      .selectFrom('sammel.member_order')
      .selectAll()
      .where('id', 'in', ids())
      .orderBy('id')
      .execute();
    if (!orders.length) return [];
    const [items, payments, emails, events] = await Promise.all([
      db
        .selectFrom('sammel.order_item')
        .selectAll()
        .where('order_id', 'in', ids())
        .orderBy('order_id')
        .orderBy('position')
        .execute(),
      db.selectFrom('sammel.payment').selectAll().where('order_id', 'in', ids()).execute(),
      db
        .selectFrom('sammel.payment_email')
        .selectAll()
        .where('order_id', 'in', ids())
        .orderBy('order_id')
        .orderBy('position')
        .execute(),
      db
        .selectFrom('sammel.payment_event')
        .selectAll()
        .where('order_id', 'in', ids())
        .orderBy('order_id')
        .orderBy('id')
        .execute(),
    ]);
    const current = new Map(
      (
        await db
          .selectFrom('sammel.member_order')
          .select(['id', 'version'])
          .where('id', 'in', ids())
          .execute()
      ).map((row) => [row.id, toVersion(row.version)])
    );
    if (orders.some((row) => current.get(row.id) !== toVersion(row.version))) {
      if (attempt >= 5) throw new VersionConflictError();
      continue;
    }
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
}

function orderIds(db: Db, filter: OrderFilter) {
  let query = db.selectFrom('sammel.member_order').select('id');
  if ('id' in filter) return query.where('id', '=', filter.id);
  query = query.where('campaign_id', '=', filter.campaignId);
  return filter.email === undefined ? query : query.where('email', '=', filter.email);
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
  const version = requireVersion(etag);
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
  const version = requireVersion(etag);
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
