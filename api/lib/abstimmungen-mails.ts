import { sql } from 'kysely';
import { getDb, getLockDb, inTransaction, lockResource } from './db';
import type { Db } from './db';
import type { AbstimmungMailArt } from './abstimmung-model';
import { AbstimmungForbiddenError, newAbstimmungToken } from './abstimmungen-basis';
import { loadRow } from './abstimmungen-lesen';
import { assertPlatz, openForVote } from './abstimmungen-stimmen';

/** Logins of the leaders who answered in the Leitendenbereich. */
export async function getAbstimmungLogins(id: number): Promise<string[]> {
  const rows = await getDb()
    .selectFrom('abstimmung.teilnahme')
    .select('login')
    .where('abstimmung_id', '=', id)
    .where('login', 'is not', null)
    .execute();
  return rows.flatMap((row) => (row.login ? [row.login] : []));
}

/** Counts of the mails of one Abstimmung. */
export interface AbstimmungMailStand {
  /** Still to send. */
  offen: number;
  gesendet: number;
  /** Reserved, but unclear whether the mail went out; never sent again automatically. */
  unklar: number;
}

export async function getAbstimmungMailStand(id: number): Promise<AbstimmungMailStand> {
  const rows = await getDb()
    .selectFrom('abstimmung.teilnahme')
    .select(['mail_status', (eb) => eb.fn.countAll<number>().as('anzahl')])
    .where('abstimmung_id', '=', id)
    .where('mail_status', 'is not', null)
    .groupBy('mail_status')
    .execute();
  const anzahl = (status: string): number =>
    Number(rows.find((row) => row.mail_status === status)?.anzahl ?? 0);
  return { offen: anzahl('offen'), gesendet: anzahl('gesendet'), unklar: anzahl('versucht') };
}

/** An address to invite, with the name from CampFlow if known. */
export interface AbstimmungEinladung {
  email: string;
  name: string;
  /** Several CampFlow persons share the address, e.g. a family. */
  familie: boolean;
}

/**
 * Queues an invitation for every address that has none yet; addresses invited before are left
 * as they are. Returns how many are new and how many were invited already.
 */
export async function queueAbstimmungEinladungen(
  id: number,
  login: string,
  einladungen: AbstimmungEinladung[],
  /**
   * CampFlow addresses of leaders who answered here with their login; an invitation to one of
   * them alone would count them twice. A family address still gets its invitation.
   */
  eigeneAdressen: readonly string[] = []
): Promise<{ neu: number; schon: number }> {
  return inTransaction(async (trx) => {
    const row = await openForVote(trx, id);
    if (row.erstellt_von !== login) throw new AbstimmungForbiddenError();
    // Leaders who answered here count with their login and their stored address
    const vorhanden = new Set(
      (
        await trx
          .selectFrom('abstimmung.teilnahme')
          .select(['email', 'login'])
          .where('abstimmung_id', '=', id)
          .execute()
      ).flatMap((t) => [t.email, t.login])
    );
    const beantwortet = new Set(eigeneAdressen);
    const neu = einladungen.filter(
      (einladung) =>
        !vorhanden.has(einladung.email) && (einladung.familie || !beantwortet.has(einladung.email))
    );
    if (neu.length) {
      await assertPlatz(trx, id, neu.length, 'einladung');
      // SQL Server takes at most 2100 parameters per statement
      for (let index = 0; index < neu.length; index += 200) {
        await trx
          .insertInto('abstimmung.teilnahme')
          .values(
            neu.slice(index, index + 200).map((einladung) => ({
              abstimmung_id: id,
              token: newAbstimmungToken(),
              name: einladung.name,
              email: einladung.email,
              familie: einladung.familie,
              mail_art: 'einladung' as const,
              mail_status: 'offen' as const,
            }))
          )
          .execute();
      }
    }
    return { neu: neu.length, schon: einladungen.length - neu.length };
  });
}

/** Invited people who have not answered and whose last mail is done (sent or unclear). */
function erinnerungKandidaten(db: Db, id: number) {
  return db
    .selectFrom('abstimmung.teilnahme')
    .where('abstimmung_id', '=', id)
    .where('geantwortet_am', 'is', null)
    .where('alias_von', 'is', null)
    .where('email', 'is not', null)
    .where('mail_status', 'in', ['gesendet', 'versucht']);
}

/** How many people a reminder would go to. */
export async function countAbstimmungErinnerungen(id: number): Promise<number> {
  const { count } = await erinnerungKandidaten(getDb(), id)
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  return Number(count);
}

/** Queues a reminder for everyone invited who has not answered yet; returns how many. */
export async function queueAbstimmungErinnerungen(id: number, login: string): Promise<number> {
  return inTransaction(async (trx) => {
    const row = await openForVote(trx, id);
    if (row.erstellt_von !== login) throw new AbstimmungForbiddenError();
    // Waits for a mail being sent, so `versucht` below only means an unclear result
    await lockResource(trx, mailLock(id));
    const ids = (await erinnerungKandidaten(trx, id).select('id').execute()).map((t) => t.id);
    if (!ids.length) return 0;
    await trx
      .updateTable('abstimmung.teilnahme')
      .set({ mail_art: 'erinnerung', mail_status: 'offen' })
      .where('id', 'in', ids)
      .execute();
    return ids.length;
  });
}

/** A reserved mail. */
export interface AbstimmungMail {
  teilnahmeId: number;
  email: string;
  name: string;
  token: string;
  art: AbstimmungMailArt;
  familie: boolean;
}

/** Held while one mail is reserved and sent, so a reminder cannot queue it again meanwhile. */
export function mailLock(id: number): string {
  return `abstimmung:${id}:mail`;
}

/**
 * Reserves the next queued mail, sends it with `send` and marks it as sent, all while holding
 * the mail lock. A failing `send` leaves the mail reserved (`versucht`), never sent again
 * automatically. Returns whether a mail was sent, none was queued or the Abstimmung is ended.
 */
export async function sendNextAbstimmungMail(
  id: number,
  send: (mail: AbstimmungMail) => Promise<void>
): Promise<'gesendet' | 'keine' | 'beendet'> {
  // Not `inTransaction`: the mail must not be sent again after a deadlock retry. The
  // transaction only holds the lock; reserving and marking commit on their own.
  // The lock pool, so waiting senders never hold the connections reserving and marking need
  return getLockDb()
    .transaction()
    .execute(async (trx) => {
      await lockResource(trx, mailLock(id));
      // Ending takes the same lock, so no mail starts after the Abstimmung was ended
      const row = await loadRow(getDb(), id);
      if (!row || row.geschlossen_am) return 'beendet';
      const mail = await reserveAbstimmungMail(id);
      if (!mail) return 'keine';
      await send(mail);
      await markAbstimmungMailSent(mail);
      return 'gesendet';
    });
}

/** Reserves the next mail to send; concurrent steps never get the same one. */
export async function reserveAbstimmungMail(id: number): Promise<AbstimmungMail | undefined> {
  // READCOMMITTEDLOCK: READPAST needs locking reads, Azure SQL reads row versions by default
  const result = await sql<{
    id: number;
    email: string;
    name: string;
    token: string;
    mail_art: AbstimmungMailArt;
    familie: boolean;
  }>`
    WITH next AS (
      SELECT TOP (1) id, email, name, token, mail_art, mail_status, familie
      FROM abstimmung.teilnahme WITH (UPDLOCK, READPAST, READCOMMITTEDLOCK)
      WHERE abstimmung_id = ${id} AND mail_status = 'offen'
      ORDER BY id
    )
    UPDATE next SET mail_status = 'versucht'
    OUTPUT inserted.id, inserted.email, inserted.name, inserted.token, inserted.mail_art, inserted.familie;
  `.execute(getDb());
  const row = result.rows[0];
  return row
    ? {
        teilnahmeId: row.id,
        email: row.email,
        name: row.name,
        token: row.token,
        art: row.mail_art,
        familie: Boolean(row.familie),
      }
    : undefined;
}

/** Marks a reserved mail as sent. */
export async function markAbstimmungMailSent(mail: AbstimmungMail): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .updateTable('abstimmung.teilnahme')
    .set({
      mail_status: 'gesendet',
      ...(mail.art === 'einladung' ? { eingeladen_am: now } : { erinnert_am: now }),
    })
    .where('id', '=', mail.teilnahmeId)
    .where('mail_status', '=', 'versucht')
    .execute();
}
