import type { Insertable, Selectable, Transaction } from 'kysely';
import type { Database } from './db-schema';
import type { SammelPaymentTable } from './db-schema-sammel';
import type { SammelArtikel, SammelKatalogArtikel } from './sammelbestellung-model';
import { parseSammelPayment } from './sammelbestellung-payment-storage';
import type { SammelPaymentRecord, SammelPaymentEvent } from './sammelbestellung-payment-model';
import { time, iso, storedShop } from './sammelbestellung-list-basis';

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
export function paymentRecord(
  row: Selectable<SammelPaymentTable>,
  emails: string[]
): SammelPaymentRecord {
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
