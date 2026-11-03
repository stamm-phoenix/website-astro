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
  bis: Date | null;
}): Erledigung {
  return {
    status: row.status,
    login: row.login,
    name: row.name,
    am: row.am.toISOString(),
    bis: (row.bis ?? row.am).toISOString(),
  };
}

/** A newer message arrived than the page showed; marking it done would close it unseen. */
export class NeueNachrichtError extends Error {
  constructor() {
    super('A newer message arrived than the page showed.');
    this.name = 'NeueNachrichtError';
  }
}

/** The marks of the mailbox, by conversation ID. */
export async function getErledigungen(postfach: string): Promise<Map<string, Erledigung>> {
  const rows = await getDb()
    .selectFrom('postfach.erledigung')
    .select(['konversation_id', 'status', 'login', 'name', 'am', 'bis'])
    .where('postfach', '=', postfach)
    .execute();
  return new Map(rows.map((row) => [row.konversation_id, toErledigung(row)]));
}

/**
 * Sets the status of the conversation; `offen` removes the mark. `vorher` is the status the page
 * showed, `gesehen` the received time of the newest message it showed and `neueste` that of the
 * newest one now. A mark covers the messages up to `gesehen`. If someone changed the status
 * meanwhile, nothing is saved and `ErledigungKonfliktError` names what applies now; if a newer
 * message arrived, `NeueNachrichtError`.
 */
export async function setzeErledigung(
  postfach: string,
  konversation: string,
  status: PostfachStatus,
  vorher: PostfachStatus,
  gesehen: string,
  neueste: string,
  von: Person,
  betreff: string
): Promise<Erledigung | null> {
  return inTransaction(async (trx) => {
    await lockResource(trx, `postfach-erledigung:${postfach}:${konversation}`);
    const row = await trx
      .selectFrom('postfach.erledigung')
      .select(['status', 'login', 'name', 'am', 'bis'])
      .where('postfach', '=', postfach)
      .where('konversation_id', '=', konversation)
      .executeTakeFirst();
    // A mark older than the newest message no longer counts, as on the page
    const gespeichert = row ? toErledigung(row) : null;
    const aktuell = gespeichert && gespeichert.bis >= neueste ? gespeichert : null;
    if ((aktuell?.status ?? 'offen') !== vorher) throw new ErledigungKonfliktError(aktuell);
    if (status !== 'offen' && neueste > gesehen) throw new NeueNachrichtError();
    if (status === 'offen') {
      await trx
        .deleteFrom('postfach.erledigung')
        .where('postfach', '=', postfach)
        .where('konversation_id', '=', konversation)
        .execute();
      return null;
    }
    const values = {
      status,
      login: von.login,
      name: von.name,
      betreff: betreff.slice(0, 400),
      bis: new Date(gesehen),
    };
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
      .select(['status', 'login', 'name', 'am', 'bis'])
      .where('postfach', '=', postfach)
      .where('konversation_id', '=', konversation)
      .executeTakeFirstOrThrow();
    return toErledigung(saved);
  });
}
