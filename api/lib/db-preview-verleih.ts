import { inTransaction } from './db';
import type { Db } from './db';

/** Invented delivery marker; never sends mail or offers an invalid test address for retry. */
async function seedMail(db: Db, id: number): Promise<void> {
  if (await db.selectFrom('organisation.verleih_mail').select('id').top(1).executeTakeFirst())
    return;
  await db
    .insertInto('organisation.verleih_mail')
    .values({
      verleih_id: id,
      empfaenger: 'material-test@example.invalid',
      betreff: 'Ausleihe eingetragen (Test)',
      text: 'Erfundener Versandverlauf; keine echte E-Mail versandt.',
      gesendet: true,
    })
    .execute();
}
/** Fill missing preview data, including the mail table cleared by the workflow migration. */
export async function seedPreviewVerleih(): Promise<void> {
  await inTransaction(async (trx) => {
    const vorhanden = await trx
      .selectFrom('organisation.verleih')
      .select('id')
      .top(1)
      .executeTakeFirst();
    if (vorhanden) {
      await seedMail(trx, vorhanden.id);
      return;
    }
    const variante = await trx
      .selectFrom('organisation.inventar_variante as v')
      .innerJoin('organisation.inventar_artikel as a', 'a.id', 'v.artikel_id')
      .select(['v.id', 'a.bezeichnung'])
      .where('v.bestand', '>', 0)
      .top(1)
      .executeTakeFirst();
    if (!variante) return;
    const { id } = await trx
      .insertInto('organisation.verleih')
      .values({
        status: 'ausgegeben',
        antragsteller: 'material-test@example.invalid',
        entleiher: 'Roverrunde (Test)',
        verantwortlich: 'Anna Beispiel',
        kontakt: 'material-test@example.invalid',
        von: '2027-07-01',
        bis: '2027-07-07',
        notizen: 'Erfundene Ausleihe für das Sommerlager.',
      })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('organisation.verleih_position')
      .values({
        verleih_id: id,
        variante_id: variante.id,
        bezeichnung: variante.bezeichnung,
        menge: 1,
      })
      .execute();
    await trx
      .insertInto('organisation.verleih_verlauf')
      .values({ verleih_id: id, von: 'preview', text: 'Ausleihe eingetragen (Test).' })
      .execute();
    await seedMail(trx, id);
  });
}
