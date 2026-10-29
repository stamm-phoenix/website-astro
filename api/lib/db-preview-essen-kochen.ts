import { getDb } from './db';
import type { GerichtEinheit } from './essen-gerichte-model';

/**
 * Marks the first planned dish of the „Sommerlager (Test)“ of a PR preview as cooked, with what
 * it used as planned (`docs/essensplanung.md`), so the stock has something to show. Only when no
 * dish was ticked off yet, like the other seed steps.
 */
export async function seedPreviewEssensplanungKochen(): Promise<void> {
  const db = getDb();
  const planung = await db
    .selectFrom('essen.planung')
    .select('id')
    .where('name', '=', 'Sommerlager (Test)')
    .executeTakeFirst();
  if (!planung) return;
  const einplanungen = await db
    .selectFrom('essen.einplanung as e')
    .innerJoin('essen.mahlzeit as m', 'm.id', 'e.mahlzeit_id')
    .innerJoin('essen.tag as t', 't.id', 'm.tag_id')
    .select(['e.id', 'e.gericht_id', 'e.status'])
    .where('t.planung_id', '=', planung.id)
    .orderBy('t.datum')
    .orderBy('m.position')
    .orderBy('e.position')
    .execute();
  const erste = einplanungen[0];
  if (!erste || einplanungen.some((e) => e.status !== 'offen')) return;
  const zutaten = await db
    .selectFrom('essen.gericht_zutat')
    .select(['planung_zutat_id', 'menge', 'einheit'])
    .where('gericht_id', '=', erste.gericht_id)
    .execute();
  // One row per ingredient and unit, as saving a cooked dish sums them
  const verbrauch = new Map<
    string,
    { planung_zutat_id: number; menge: number; einheit: GerichtEinheit }
  >();
  for (const { planung_zutat_id, menge, einheit } of zutaten) {
    if (menge === null || einheit === null) continue;
    const key = `${planung_zutat_id}:${einheit}`;
    const da = verbrauch.get(key);
    if (da) da.menge += Number(menge);
    else verbrauch.set(key, { planung_zutat_id, menge: Number(menge), einheit });
  }
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('essen.einplanung')
      .set({ status: 'gekocht' })
      .where('id', '=', erste.id)
      .execute();
    for (const v of verbrauch.values()) {
      await trx
        .insertInto('essen.einplanung_verbrauch')
        .values({ einplanung_id: erste.id, ...v })
        .execute();
    }
  });
}
