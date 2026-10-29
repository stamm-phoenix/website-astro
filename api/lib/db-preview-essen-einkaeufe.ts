import { getDb, toDateString } from './db';

/**
 * Invented shopping trips for the „Sommerlager (Test)“ of a PR preview (`docs/essensplanung.md`,
 * Einkäufe): one at the wholesale market with something ticked off and a rule, one for every
 * shop. Fills only what is missing, like the other seed steps; runs after the shops are seeded.
 */
export async function seedPreviewEssensplanungEinkaeufe(): Promise<void> {
  const db = getDb();
  const planung = await db
    .selectFrom('essen.planung')
    .select('id')
    .where('name', '=', 'Sommerlager (Test)')
    .executeTakeFirst();
  if (!planung) return;
  const vorhanden = await db
    .selectFrom('essen.einkauf')
    .select('id')
    .where('planung_id', '=', planung.id)
    .top(1)
    .executeTakeFirst();
  if (vorhanden) return;
  const [geschaeft, mahlzeit, zutaten, mitglied] = await Promise.all([
    db
      .selectFrom('essen.geschaeft')
      .select('id')
      .where('planung_id', '=', planung.id)
      .orderBy('position')
      .top(1)
      .executeTakeFirst(),
    db
      .selectFrom('essen.mahlzeit as m')
      .innerJoin('essen.tag as t', 't.id', 'm.tag_id')
      .select(['m.id', 't.datum'])
      .where('t.planung_id', '=', planung.id)
      .orderBy('t.datum')
      .orderBy('m.position')
      .top(4)
      .execute(),
    db
      .selectFrom('essen.planung_zutat as pz')
      .leftJoin('essen.zutat as z', 'z.id', 'pz.zutat_id')
      .select(['pz.id', 'z.name', 'z.einheitenart'])
      .where('pz.planung_id', '=', planung.id)
      .orderBy('pz.id')
      .execute(),
    db
      .selectFrom('essen.mitglied')
      .select('id')
      .where('planung_id', '=', planung.id)
      .orderBy('id')
      .top(1)
      .executeTakeFirst(),
  ]);
  const erster = mahlzeit.at(-1);
  await db.transaction().execute(async (trx) => {
    const { id: grossmarkt } = await trx
      .insertInto('essen.einkauf')
      .values({
        planung_id: planung.id,
        position: 1,
        name: 'Großmarkt vor dem Lager (Test)',
        datum: erster ? toDateString(erster.datum) : null,
        geschaeft_id: geschaeft?.id ?? null,
        bis_mahlzeit_id: erster?.id ?? null,
      })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    const { id: rest } = await trx
      .insertInto('essen.einkauf')
      .values({ planung_id: planung.id, position: 2, name: 'Nachkauf (Test)' })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    // Something by mass ticked off with less than planned and a replacement
    const masse = zutaten.find((z) => z.einheitenart === 'masse' && z.name !== 'Salz');
    if (masse) {
      await trx
        .insertInto('essen.einkauf_posten')
        .values({
          einkauf_id: grossmarkt,
          planung_zutat_id: masse.id,
          einheit: 'kg',
          erhalten: 1,
          ersatz: 'Eigenmarke (Test)',
          abgehakt_von_mitglied_id: mitglied?.id ?? null,
        })
        .execute();
    }
    // Dish soap moves to the second trip
    const spuelmittel = zutaten.find((z) => z.name === 'Spülmittel');
    if (spuelmittel) {
      await trx
        .insertInto('essen.einkauf_regel')
        .values([
          { einkauf_id: grossmarkt, planung_zutat_id: spuelmittel.id, art: 'ohne' },
          { einkauf_id: rest, planung_zutat_id: spuelmittel.id, art: 'mit' },
        ])
        .execute();
    }
  });
}
