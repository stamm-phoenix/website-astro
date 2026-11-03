import { sql } from 'kysely';
import { CONFIG } from './config';
import { getDb, inTransaction, lockResource } from './db';
import type { LeseStand, Zustaendigkeit } from './postfach-model';

/**
 * What the Leitendenbereich keeps about the shared mailboxes in Azure SQL (schema `postfach`,
 * migration 0080): who is responsible for a conversation and what each person has read. The
 * messages themselves stay in Exchange.
 */

const DAY_MS = 86_400_000;

/** Someone else changed the responsibility since the page loaded it. */
export class ZustaendigkeitKonfliktError extends Error {
  constructor(public readonly aktuell: Zustaendigkeit | null) {
    super('The responsibility changed meanwhile.');
    this.name = 'ZustaendigkeitKonfliktError';
  }
}

export interface Person {
  login: string;
  name: string;
}

/**
 * The read state of the person in the mailbox. On the first visit it starts
 * `CONFIG.postfaecher.ungelesenTage` back, so the whole inbox is not unread at once.
 */
export async function getLeseStand(
  postfach: string,
  userId: string,
  login: string,
  now: Date = new Date()
): Promise<LeseStand> {
  const db = getDb();
  let leser = await db
    .selectFrom('postfach.leser')
    .select('gelesen_bis')
    .where('postfach', '=', postfach)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!leser) {
    const gelesenBis = new Date(now.getTime() - CONFIG.postfaecher.ungelesenTage * DAY_MS);
    leser = await inTransaction(async (trx) => {
      await lockResource(trx, `postfach-leser:${postfach}:${userId}`);
      const row = await trx
        .selectFrom('postfach.leser')
        .select('gelesen_bis')
        .where('postfach', '=', postfach)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (row) return row;
      await trx
        .insertInto('postfach.leser')
        .values({ postfach, user_id: userId, login, gelesen_bis: gelesenBis })
        .execute();
      return { gelesen_bis: gelesenBis };
    });
  }
  const rows = await db
    .selectFrom('postfach.gelesen')
    .select(['nachricht_id', 'gelesen'])
    .where('postfach', '=', postfach)
    .where('user_id', '=', userId)
    .execute();
  return {
    marken: new Map(rows.map((row) => [row.nachricht_id, Boolean(row.gelesen)])),
    gelesenBis: leser.gelesen_bis.toISOString(),
  };
}

/** Marks the messages as read or unread for the person. */
export async function markiereNachrichten(
  postfach: string,
  userId: string,
  nachrichten: readonly string[],
  gelesen: boolean
): Promise<void> {
  if (!nachrichten.length) return;
  await inTransaction(async (trx) => {
    await lockResource(trx, `postfach-leser:${postfach}:${userId}`);
    await trx
      .deleteFrom('postfach.gelesen')
      .where('postfach', '=', postfach)
      .where('user_id', '=', userId)
      .where('nachricht_id', 'in', [...nachrichten])
      .execute();
    await trx
      .insertInto('postfach.gelesen')
      .values(
        nachrichten.map((nachricht_id) => ({ postfach, user_id: userId, nachricht_id, gelesen }))
      )
      .execute();
  });
}

/**
 * „Alle als gelesen markieren“: everything received until now counts as read; marks of single
 * messages of the person are dropped, also the unread ones; those of others stay as they are.
 */
export async function alleGelesen(
  postfach: string,
  userId: string,
  login: string,
  now: Date = new Date()
): Promise<void> {
  await inTransaction(async (trx) => {
    await lockResource(trx, `postfach-leser:${postfach}:${userId}`);
    await trx
      .deleteFrom('postfach.gelesen')
      .where('postfach', '=', postfach)
      .where('user_id', '=', userId)
      .execute();
    const updated = await trx
      .updateTable('postfach.leser')
      .set({ gelesen_bis: now, login })
      .where('postfach', '=', postfach)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 0) {
      await trx
        .insertInto('postfach.leser')
        .values({ postfach, user_id: userId, login, gelesen_bis: now })
        .execute();
    }
  });
}

function toZustaendigkeit(row: {
  login: string;
  name: string;
  von_login: string;
  von_name: string;
  am: Date;
}): Zustaendigkeit {
  return {
    login: row.login,
    name: row.name,
    vonLogin: row.von_login,
    vonName: row.von_name,
    am: row.am.toISOString(),
  };
}

/** The responsibilities of the mailbox, by conversation ID. */
export async function getZustaendigkeiten(postfach: string): Promise<Map<string, Zustaendigkeit>> {
  const rows = await getDb()
    .selectFrom('postfach.zustaendigkeit')
    .select(['konversation_id', 'login', 'name', 'von_login', 'von_name', 'am'])
    .where('postfach', '=', postfach)
    .execute();
  return new Map(rows.map((row) => [row.konversation_id, toZustaendigkeit(row)]));
}

/**
 * Makes `neu` responsible for the conversation, or nobody with `null`. `vorher` is the login the
 * page showed (null: nobody); if someone changed it meanwhile, nothing is saved and
 * `ZustaendigkeitKonfliktError` names the current person.
 */
export async function setzeZustaendigkeit(
  postfach: string,
  konversation: string,
  neu: Person | null,
  vorher: string | null,
  von: Person,
  betreff: string
): Promise<Zustaendigkeit | null> {
  return inTransaction(async (trx) => {
    await lockResource(trx, `postfach-zustaendigkeit:${postfach}:${konversation}`);
    const row = await trx
      .selectFrom('postfach.zustaendigkeit')
      .select(['login', 'name', 'von_login', 'von_name', 'am'])
      .where('postfach', '=', postfach)
      .where('konversation_id', '=', konversation)
      .executeTakeFirst();
    const aktuell = row ? toZustaendigkeit(row) : null;
    if ((aktuell?.login.toLowerCase() ?? null) !== (vorher?.toLowerCase() ?? null))
      throw new ZustaendigkeitKonfliktError(aktuell);
    if (!neu) {
      await trx
        .deleteFrom('postfach.zustaendigkeit')
        .where('postfach', '=', postfach)
        .where('konversation_id', '=', konversation)
        .execute();
      return null;
    }
    const values = {
      login: neu.login,
      name: neu.name,
      von_login: von.login,
      von_name: von.name,
      betreff: betreff.slice(0, 400),
    };
    if (row) {
      await trx
        .updateTable('postfach.zustaendigkeit')
        .set({ ...values, am: sql<Date>`SYSUTCDATETIME()` })
        .where('postfach', '=', postfach)
        .where('konversation_id', '=', konversation)
        .execute();
    } else {
      await trx
        .insertInto('postfach.zustaendigkeit')
        .values({ postfach, konversation_id: konversation, ...values })
        .execute();
    }
    const saved = await trx
      .selectFrom('postfach.zustaendigkeit')
      .select(['login', 'name', 'von_login', 'von_name', 'am'])
      .where('postfach', '=', postfach)
      .where('konversation_id', '=', konversation)
      .executeTakeFirstOrThrow();
    return toZustaendigkeit(saved);
  });
}
