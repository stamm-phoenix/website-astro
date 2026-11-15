import { getDb, inTransaction, lockResource } from './db';
import type { Db } from './db';
import { escapeHtml, sendMail } from './mail';
import { CONFIG } from './config';
export async function enqueueVerleihMail(
  db: Db,
  id: number,
  empfaenger: string,
  betreff: string,
  text: string
): Promise<void> {
  await db
    .insertInto('organisation.verleih_mail')
    .values({ verleih_id: id, empfaenger, betreff, text })
    .execute();
}
/** Each successful message commits independently, even if the next recipient fails. */
export async function sendVerleihMails(id: number, site: string): Promise<boolean> {
  try {
    const rows = await getDb()
      .selectFrom('organisation.verleih_mail')
      .select('id')
      .where('verleih_id', '=', id)
      .where('gesendet', '=', false)
      .top(3)
      .execute();
    let success = true;
    for (const pending of rows) {
      try {
        await inTransaction(async (trx) => {
          await lockResource(trx, `verleih-mail:${pending.id}`);
          const row = await trx
            .selectFrom('organisation.verleih_mail')
            .selectAll()
            .where('id', '=', pending.id)
            .where('gesendet', '=', false)
            .executeTakeFirst();
          if (!row) return;
          const link = `${site}/leitendenbereich/verleih?ausleihe=${id}`;
          await sendMail(
            row.empfaenger,
            row.betreff,
            `<p>${escapeHtml(row.text)}</p><p><a href="${escapeHtml(link)}">Ausleihe öffnen</a></p>`,
            CONFIG.mail.verleihSender,
            undefined,
            { retry: false, timeoutMs: 7000 }
          );
          await trx
            .updateTable('organisation.verleih_mail')
            .set({ gesendet: true })
            .where('id', '=', row.id)
            .execute();
        });
      } catch {
        success = false;
      }
    }
    const pending = await getDb()
      .selectFrom('organisation.verleih_mail')
      .select('id')
      .where('verleih_id', '=', id)
      .where('gesendet', '=', false)
      .top(1)
      .executeTakeFirst();
    return success && !pending;
  } catch {
    return false;
  }
}
