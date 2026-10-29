import { getDb } from './db';

/**
 * Invented shops, stock and extra needs for the „Sommerlager (Test)“ of a PR preview
 * (`docs/essensplanung.md`). Fills only what is missing, like the other seed steps.
 */
export async function seedPreviewEssensplanungEinkauf(): Promise<void> {
  const db = getDb();
  const planung = await db
    .selectFrom('essen.planung')
    .select('id')
    .where('name', '=', 'Sommerlager (Test)')
    .executeTakeFirst();
  if (!planung) return;
  const vorhanden = await db
    .selectFrom('essen.geschaeft')
    .select('id')
    .where('planung_id', '=', planung.id)
    .top(1)
    .executeTakeFirst();
  if (vorhanden) return;
  await db.transaction().execute(async (trx) => {
    const geschaefte: { id: number }[] = [];
    for (const [index, name] of ['Großmarkt (Test)', 'Bäckerei (Test)'].entries()) {
      geschaefte.push(
        await trx
          .insertInto('essen.geschaeft')
          .values({ planung_id: planung.id, position: index + 1, name })
          .output('inserted.id')
          .executeTakeFirstOrThrow()
      );
    }
    // The ingredients the dishes use are bought at the wholesale market
    await trx
      .updateTable('essen.planung_zutat')
      .set({ geschaeft_id: geschaefte[0].id })
      .where('planung_id', '=', planung.id)
      .execute();

    /** The ingredient of the Planung for a central one, added if it is not used yet. */
    const zutat = async (name: string): Promise<number | null> => {
      const zentral = await trx
        .selectFrom('essen.zutat')
        .select('id')
        .where('name', '=', name)
        .executeTakeFirst();
      if (!zentral) return null;
      const da = await trx
        .selectFrom('essen.planung_zutat')
        .select('id')
        .where('planung_id', '=', planung.id)
        .where('zutat_id', '=', zentral.id)
        .executeTakeFirst();
      if (da) return da.id;
      const { id } = await trx
        .insertInto('essen.planung_zutat')
        .values({ planung_id: planung.id, zutat_id: zentral.id, geschaeft_id: geschaefte[0].id })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      return id;
    };
    const salz = await zutat('Salz');
    if (salz) {
      await trx
        .insertInto('essen.bestand')
        .values({
          planung_id: planung.id,
          planung_zutat_id: salz,
          menge: 1,
          einheit: 'kg',
          hinweis: 'im Küchenschrank (Test)',
        })
        .execute();
    }
    for (const [name, menge] of [
      ['Spülmittel', 3],
      ['Müllbeutel (groß)', 2],
    ] as const) {
      const id = await zutat(name);
      if (!id) continue;
      await trx
        .insertInto('essen.zusatzbedarf')
        .values({ planung_id: planung.id, planung_zutat_id: id, menge, einheit: 'stueck' })
        .execute();
    }
  });
}
