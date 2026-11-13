import type { Selectable } from 'kysely';
import { toVersion, VersionConflictError } from './db';
import type { Db } from './db';
import type {
  SammelOrderItemTable,
  SammelOrderTable,
  SammelPaymentEventTable,
  SammelPaymentTable,
} from './db-schema';

export type OrderFilter = { id: number } | { campaignId: number; email?: string };

/** Rows of the child tables stay below the 2100 parameters of one SQL Server statement. */
const ID_CHUNK = 1000;

export interface OrderRows {
  orders: Selectable<SammelOrderTable>[];
  items: Selectable<SammelOrderItemTable>[];
  payments: Selectable<SammelPaymentTable>[];
  emails: { order_id: number; email: string }[];
  events: Selectable<SammelPaymentEventTable>[];
}

/** Groups rows by a numeric key, keeping the order of the rows. */
export function groupBy<T extends Record<K, number>, K extends string>(
  rows: T[],
  key: K
): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const group = groups.get(row[key]);
    if (group) group.push(row);
    else groups.set(row[key], [row]);
  }
  return groups;
}

/**
 * Reads orders with their articles, payment and history. The statements see no common snapshot,
 * so a write committing in between could pair a new order version with an old payment state.
 * Every change of those rows also writes the order row, so the order versions are read first
 * and checked again at the end; if one changed, the whole read is repeated. The child tables are
 * read by the IDs of the orders already read, so no statement scans the campaign again.
 */
export async function loadOrderRows(db: Db, filter: OrderFilter): Promise<OrderRows> {
  for (let attempt = 1; ; attempt++) {
    const orders = await db
      .selectFrom('sammel.member_order')
      .selectAll()
      .where('id', 'in', orderIds(db, filter))
      .orderBy('id')
      .execute();
    const empty: OrderRows = { orders, items: [], payments: [], emails: [], events: [] };
    if (!orders.length) return empty;
    const ids = orders.map((row) => row.id);
    // Ascending chunks of ascending IDs: the concatenation keeps the order of each query
    const chunked = async <R>(read: (chunk: number[]) => Promise<R[]>): Promise<R[]> => {
      const parts: R[][] = [];
      for (let from = 0; from < ids.length; from += ID_CHUNK)
        parts.push(await read(ids.slice(from, from + ID_CHUNK)));
      return parts.flat();
    };
    const [items, payments, emails, events, current] = await Promise.all([
      chunked((chunk) =>
        db
          .selectFrom('sammel.order_item')
          .selectAll()
          .where('order_id', 'in', chunk)
          .orderBy('order_id')
          .orderBy('position')
          .execute()
      ),
      chunked((chunk) =>
        db.selectFrom('sammel.payment').selectAll().where('order_id', 'in', chunk).execute()
      ),
      chunked((chunk) =>
        db
          .selectFrom('sammel.payment_email')
          .selectAll()
          .where('order_id', 'in', chunk)
          .orderBy('order_id')
          .orderBy('position')
          .execute()
      ),
      chunked((chunk) =>
        db
          .selectFrom('sammel.payment_event')
          .selectAll()
          .where('order_id', 'in', chunk)
          .orderBy('order_id')
          .orderBy('id')
          .execute()
      ),
      chunked((chunk) =>
        db
          .selectFrom('sammel.member_order')
          .select(['id', 'version'])
          .where('id', 'in', chunk)
          .execute()
      ),
    ]);
    const versions = new Map(current.map((row) => [row.id, toVersion(row.version)]));
    if (orders.some((row) => versions.get(row.id) !== toVersion(row.version))) {
      if (attempt >= 5) throw new VersionConflictError();
      continue;
    }
    return { orders, items, payments, emails, events };
  }
}

function orderIds(db: Db, filter: OrderFilter) {
  let query = db.selectFrom('sammel.member_order').select('id');
  if ('id' in filter) return query.where('id', '=', filter.id);
  query = query.where('campaign_id', '=', filter.campaignId);
  return filter.email === undefined ? query : query.where('email', '=', filter.email);
}
