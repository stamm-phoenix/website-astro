import type { Selectable } from 'kysely';
import type { Db } from './db';
import { toVersion, VersionConflictError } from './db';
import type {
  SammelOrderItemTable,
  SammelOrderTable,
  SammelPaymentEventTable,
  SammelPaymentTable,
} from './db-schema';
import { SAMMEL_STATUS } from './sammelbestellung-model';
import { parseSammelPayment, parseSammelPaymentEvents } from './sammelbestellung-payment-storage';
import type { SammelPaymentRecord } from './sammelbestellung-payment-model';
import type { OrderRow } from './sammelbestellung-list';
import { groupBy, InvalidSammelDataError, iso, validStored } from './sammelbestellung-stored';
import { validateSammelItems } from './sammelbestellung-validation';

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

export type OrderFilter = { id: number } | { campaignId: number; email?: string };

/** SQL Server allows 2100 parameters per statement; the ID lists stay well below. */
const ID_CHUNK = 1000;

/**
 * Reads orders with their articles, payment and history. The statements see no common snapshot,
 * so a write committing in between could pair a new order version with an old payment state.
 * Every change of those rows also writes the order row, so the order rows are read first, their
 * rows are read by the loaded IDs (the campaign is scanned once, not once per table), and the
 * versions are checked again at the end; if one changed, the whole read is repeated.
 */
export async function loadOrders(db: Db, filter: OrderFilter): Promise<OrderRow[]> {
  for (let attempt = 1; ; attempt++) {
    const orders = await selectOrders(db, filter);
    if (!orders.length) return [];
    const ids = orders.map((row) => row.id);
    const [items, payments, emails, events] = await Promise.all([
      inChunks(ids, (chunk) =>
        db
          .selectFrom('sammel.order_item')
          .selectAll()
          .where('order_id', 'in', chunk)
          .orderBy('order_id')
          .orderBy('position')
          .execute()
      ),
      inChunks(ids, (chunk) =>
        db.selectFrom('sammel.payment').selectAll().where('order_id', 'in', chunk).execute()
      ),
      inChunks(ids, (chunk) =>
        db
          .selectFrom('sammel.payment_email')
          .selectAll()
          .where('order_id', 'in', chunk)
          .orderBy('order_id')
          .orderBy('position')
          .execute()
      ),
      inChunks(ids, (chunk) =>
        db
          .selectFrom('sammel.payment_event')
          .selectAll()
          .where('order_id', 'in', chunk)
          .orderBy('order_id')
          .orderBy('id')
          .execute()
      ),
    ]);
    const current = new Map(
      (
        await inChunks(ids, (chunk) =>
          db
            .selectFrom('sammel.member_order')
            .select(['id', 'version'])
            .where('id', 'in', chunk)
            .execute()
        )
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

/** Runs `read` for slices of `ids` and joins the rows in the order of the slices. */
async function inChunks<T>(ids: number[], read: (chunk: number[]) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; start < ids.length; start += ID_CHUNK)
    rows.push(...(await read(ids.slice(start, start + ID_CHUNK))));
  return rows;
}

function selectOrders(db: Db, filter: OrderFilter): Promise<Selectable<SammelOrderTable>[]> {
  let query = db.selectFrom('sammel.member_order').selectAll().orderBy('id');
  if ('id' in filter) return query.where('id', '=', filter.id).execute();
  query = query.where('campaign_id', '=', filter.campaignId);
  return (filter.email === undefined ? query : query.where('email', '=', filter.email)).execute();
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
