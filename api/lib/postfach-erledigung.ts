import { sql } from 'kysely';
import { getDb, inTransaction, lockResource } from './db';
import type { Erledigung, PostfachStatus } from './postfach-model';
import type { Person } from './postfach-stand';

/**
 * Whether a conversation of a mailbox is done or needs nothing (`postfach.erledigung`, migration
 * 0081). Without a row it is open; a message newer than the mark opens it again
 * (`konversationenAus`).
 */

/** Someone else changed the status since the page loaded it. */
export class ErledigungKonfliktError extends Error {
  constructor(public readonly aktuell: Erledigung | null) {
    super('The status changed meanwhile.');
    this.name = 'ErledigungKonfliktError';
  }
}

function toErledigung(row: {
  status: Erledigung['status'];
  login: string;
  name: string;
  am: Date;
}): Erledigung {
  return { status: row.status, login: row.login, name: row.name, am: row.am.toISOString() };
}

/** The marks of the mailbox, by conversation ID. */
export async function getErledigungen(postfach: string): Promise<Map<string, Erledigung>> {
  const rows = await getDb()
    .selectFrom('postfach.erledigung')
    .select(['konversation_id', 'status', 'login', 'name', 'am'])
    .where('postfach', '=', postfach)
    .execute();
  return new Map(rows.map((row) => [row.konversation_id, toErledigung(row)]));
}

/**
 * Sets the status of the conversation; `offen` removes the mark. `vorher` is the status the page
 * showed and `neueste` the time of the newest received message, which decides whether a stored
 * mark still counts. If someone changed it meanwhile, nothing is saved and
 * `ErledigungKonfliktError` names what applies now.
 */
export async function setzeErledigung(
  postfach: string,
  konversation: string,
  status: PostfachStatus,
  vorher: PostfachStatus,
  neueste: string,
  von: Person,
  betreff: string
): Promise<Erledigung | null> {
  return inTransaction(async (trx) => {
    await lockResource(trx, `postfach-erledigung:${postfach}:${konversation}`);
    const row = await trx
      .selectFrom('postfach.erledigung')
      .select(['status', 'login', 'name', 'am'])
      .where('postfach', '=', postfach)
      .where('konversation_id', '=', konversation)
      .executeTakeFirst();
    // A mark older than the newest message no longer counts, as on the page
    const aktuell = row && row.am.toISOString() >= neueste ? toErledigung(row) : null;
    if ((aktuell?.status ?? 'offen') !== vorher) throw new ErledigungKonfliktError(aktuell);
    if (status === 'offen') {
      await trx
        .deleteFrom('postfach.erledigung')
        .where('postfach', '=', postfach)
        .where('konversation_id', '=', konversation)
        .execute();
      return null;
    }
    const values = { status, login: von.login, name: von.name, betreff: betreff.slice(0, 400) };
    if (row) {
      await trx
        .updateTable('postfach.erledigung')
        .set({ ...values, am: sql<Date>`SYSUTCDATETIME()` })
        .where('postfach', '=', postfach)
        .where('konversation_id', '=', konversation)
        .execute();
    } else {
      await trx
        .insertInto('postfach.erledigung')
        .values({ postfach, konversation_id: konversation, ...values })
        .execute();
    }
    const saved = await trx
      .selectFrom('postfach.erledigung')
      .select(['status', 'login', 'name', 'am'])
      .where('postfach', '=', postfach)
      .where('konversation_id', '=', konversation)
      .executeTakeFirstOrThrow();
    return toErledigung(saved);
  });
}
