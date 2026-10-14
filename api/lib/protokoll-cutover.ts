import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import type { Database } from './db-schema';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getDb, getLockDb, lockResource } from './db';

const activeGate = new AsyncLocalStorage<boolean>();

export const PROTOKOLL_CUTOVER_LOCK = 'protokoll-cutover';

export class ProtokollMaintenanceError extends Error {
  readonly statusCode = 503;
  constructor() {
    super('Die Protokolle werden gerade umgestellt. Bitte später erneut versuchen.');
    this.name = 'ProtokollMaintenanceError';
  }
}

/** Do not retry this transaction: the callback can send mail or write to Graph. */
export async function withProtokollGate<T>(work: () => Promise<T>): Promise<T> {
  if (activeGate.getStore()) return work();
  return getLockDb()
    .transaction()
    .execute(async (trx) => {
      try {
        await lockResource(trx, PROTOKOLL_CUTOVER_LOCK, 'Shared');
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === `Lock ${PROTOKOLL_CUTOVER_LOCK} not granted`
        )
          throw new ProtokollMaintenanceError();
        throw error;
      }
      const state = await trx
        .selectFrom('organisation.protokoll_cutover')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirst();
      if (state?.mode !== 'sql') throw new ProtokollMaintenanceError();
      return activeGate.run(true, work);
    });
}

/** Acquiring the same lock drains in-flight API work before the freeze commits. */
export async function freezeProtokolle(): Promise<void> {
  await getDb()
    .transaction()
    .execute(async (trx) => {
      await lockResource(trx, PROTOKOLL_CUTOVER_LOCK);
      await trx
        .updateTable('organisation.protokoll_cutover')
        .set({ mode: 'frozen' })
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
    });
}

/** Verification runs while API writes and concurrent operator transitions are excluded. */
export async function activateProtokolle(verify: () => Promise<void>): Promise<void> {
  await getDb()
    .transaction()
    .execute(async (trx) => {
      await lockResource(trx, PROTOKOLL_CUTOVER_LOCK);
      const state = await trx
        .selectFrom('organisation.protokoll_cutover')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      if (state.mode !== 'frozen') throw new Error('ACTIVATION_REQUIRES_FREEZE');
      await verify();
      await trx
        .updateTable('organisation.protokoll_cutover')
        .set({ mode: 'sql', sql_started: true })
        .where('id', '=', 1)
        .execute();
    });
}

/** Keep freeze from committing during a SQL write, even if the outer gate connection is lost. */
export async function requireProtokollSqlWrite(trx: Transaction<Database>): Promise<void> {
  const result = await sql<{
    mode: string;
  }>`SELECT mode FROM organisation.protokoll_cutover WITH (HOLDLOCK) WHERE id = 1`.execute(trx);
  if (result.rows[0]?.mode !== 'sql') throw new ProtokollMaintenanceError();
}
