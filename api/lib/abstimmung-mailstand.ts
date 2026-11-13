import { getDb } from './db';

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
