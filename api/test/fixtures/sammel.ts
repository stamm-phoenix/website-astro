import { CompiledQuery } from 'kysely';
import type { Compilable, Transaction, Updateable } from 'kysely';
import { getDb, inTransaction } from '../../lib/db';
import type { Database, SammelCampaignTable, SammelOrderTable } from '../../lib/db-schema';
import {
  getSammelOrder,
  insertSammelCatalog,
  insertSammelEvent,
  replaceSammelItems,
  replaceSammelPayment,
} from '../../lib/sammelbestellung-list';
import type { OrderRow } from '../../lib/sammelbestellung-list';
import type { SammelAktion } from '../../lib/sammelbestellung-model';

export const SAMMEL_ITEM = { name: 'Kluft', reference: '00123', variant: '164', quantity: 2 };

export type SammelSeedCampaign = Omit<SammelAktion, 'etag'>;
export type SammelSeedOrder = Omit<OrderRow, 'etag' | 'payment'>;

/** Campaign 1, open until 2099, without a catalog. */
export function sammelCampaign(values: Partial<SammelSeedCampaign> = {}): SammelSeedCampaign {
  return {
    id: '1',
    title: 'Frühjahr',
    description: 'Gemeinsam bestellen',
    startsAt: '2020-01-01T00:00:00.000Z',
    endsAt: '2099-01-01T00:00:00.000Z',
    catalog: [],
    archived: false,
    ...values,
  };
}

/** Order 2 of campaign 1, submitted with one article. */
export function sammelOrder(values: Partial<SammelSeedOrder> = {}): SammelSeedOrder {
  return {
    id: '2',
    campaignId: '1',
    name: 'Familie Test',
    email: 'family@example.test',
    items: [SAMMEL_ITEM],
    notes: '',
    status: 'Eingereicht',
    submitted: true,
    paid: false,
    delivered: false,
    totalCents: null,
    linkSentAt: '',
    paymentRecord: null,
    paymentEvents: [],
    ...values,
  };
}

/**
 * Inserts with a fixed ID, so tests can sign links for known IDs. The driver sends parameterized
 * statements through sp_executesql, where SET only lasts for that batch.
 */
async function insertWithId(
  trx: Transaction<Database>,
  table: 'sammel.campaign' | 'sammel.member_order',
  query: Compilable
): Promise<void> {
  const { sql, parameters } = query.compile();
  await trx.executeQuery(
    CompiledQuery.raw(
      `SET IDENTITY_INSERT ${table} ON; ${sql}; SET IDENTITY_INSERT ${table} OFF;`,
      [...parameters]
    )
  );
}

/** Stores campaigns and orders with their IDs, including payment records and history. */
export async function seedSammel(
  campaigns: SammelSeedCampaign[] = [sammelCampaign()],
  orders: SammelSeedOrder[] = [sammelOrder()]
): Promise<void> {
  await inTransaction(async (trx) => {
    for (const campaign of campaigns) {
      await insertWithId(
        trx,
        'sammel.campaign',
        trx.insertInto('sammel.campaign').values({
          id: Number(campaign.id),
          creation_key: `00000000-0000-4000-8000-${campaign.id.padStart(12, '0')}`,
          title: campaign.title,
          description: campaign.description,
          starts_at: campaign.startsAt,
          ends_at: campaign.endsAt,
          archived: campaign.archived,
        })
      );
      await insertSammelCatalog(trx, Number(campaign.id), campaign.catalog);
    }
    for (const order of orders) {
      const id = Number(order.id);
      await insertWithId(
        trx,
        'sammel.member_order',
        trx.insertInto('sammel.member_order').values({
          id,
          campaign_id: Number(order.campaignId),
          email: order.email,
          name: order.name,
          notes: order.notes,
          status: order.status,
          submitted: order.submitted,
          paid: order.paid,
          delivered: order.delivered,
          total_cents: order.totalCents,
          link_sent_at: order.linkSentAt || null,
        })
      );
      await replaceSammelItems(trx, id, order.items);
      if (order.paymentRecord) await replaceSammelPayment(trx, id, order.paymentRecord);
      for (const event of order.paymentEvents) await insertSammelEvent(trx, id, event);
    }
  });
}

/** The order as the website reads it; fails if it is missing. */
export async function loadOrder(id = '2'): Promise<OrderRow> {
  const order = await getSammelOrder(id);
  if (!order) throw new Error(`Order ${id} missing`);
  return order;
}

/** The current version of an order, as a client would have loaded it. */
export async function orderVersion(id = '2'): Promise<string> {
  return (await loadOrder(id)).etag;
}

/** Changes an order directly, like another writer would. */
export async function changeOrder(values: Updateable<SammelOrderTable>, id = 2): Promise<void> {
  await getDb().updateTable('sammel.member_order').set(values).where('id', '=', id).execute();
}

/** Changes a campaign directly, like another writer would. */
export async function changeCampaign(
  values: Updateable<SammelCampaignTable>,
  id = 1
): Promise<void> {
  await getDb().updateTable('sammel.campaign').set(values).where('id', '=', id).execute();
}
