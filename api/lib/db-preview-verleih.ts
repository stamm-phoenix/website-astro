import { getDb, inTransaction } from './db';
/** Invented request, history and pending mail; no real recipient and no automatic delivery. */
export async function seedPreviewVerleih(): Promise<void> {
  const db = getDb();
  if (await db.selectFrom('organisation.verleih').select('id').top(1).executeTakeFirst()) return;
  const variante = await db
    .selectFrom('organisation.inventar_variante as v')
    .innerJoin('organisation.inventar_artikel as a', 'a.id', 'v.artikel_id')
    .select(['v.id', 'a.bezeichnung'])
    .where('v.bestand', '>', 0)
    .top(1)
    .executeTakeFirst();
  if (!variante) return;
  await inTransaction(async (trx) => {
    const { id } = await trx
      .insertInto('organisation.verleih')
      .values({
        status: 'antrag',
        antragsteller: 'material-test@example.invalid',
        entleiher: 'Roverrunde (Test)',
        verantwortlich: 'Anna Beispiel',
        kontakt: 'material-test@example.invalid',
        von: '2027-07-01',
        bis: '2027-07-07',
        notizen: 'Erfundener Antrag für das Sommerlager.',
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
      .values({ verleih_id: id, von: 'preview', text: 'Ausleihe beantragt (Test).' })
      .execute();
    await trx
      .insertInto('organisation.verleih_mail')
      .values({
        verleih_id: id,
        empfaenger: 'material-test@example.invalid',
        betreff: 'Ausleihe beantragt (Test)',
        text: 'Erfundene Bestätigung, nicht versandt.',
      })
      .execute();
  });
}
