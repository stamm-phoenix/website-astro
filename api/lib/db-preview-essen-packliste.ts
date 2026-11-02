import type { Db } from './db';
import { getDb } from './db';
import { packlisteSchluessel } from './essen-packliste-model';

/**
 * An invented packing list for the „Sommerlager (Test)“ of a PR preview (`docs/essensplanung.md`,
 * Packliste): one tool of a planned dish packed, one entry of its own, and one thing everyone
 * brings for themselves, partly packed. Fills only what is missing, like the other seed steps.
 */
export async function seedPreviewEssensplanungPackliste(): Promise<void> {
  const db = getDb();
  const planung = await db
    .selectFrom('essen.planung')
    .select('id')
    .where('name', '=', 'Sommerlager (Test)')
    .executeTakeFirst();
  if (!planung) return;
  const vorhanden = await db
    .selectFrom('essen.packliste_eintrag')
    .select('id')
    .where('planung_id', '=', planung.id)
    .top(1)
    .executeTakeFirst();
  if (!vorhanden) await ersteEintraege(db, planung.id);
  await fuerAlle(db, planung.id);
}

/** A tool of a planned dish, packed by the kitchen team, and a gas stove the Rover bring. */
async function ersteEintraege(db: Db, planungId: number): Promise<void> {
  const geplant = await db
    .selectFrom('essen.gericht as g')
    .select('g.werkzeuge')
    .where('g.planung_id', '=', planungId)
    .where((eb) =>
      eb.exists(
        eb.selectFrom('essen.einplanung as e').select('e.id').whereRef('e.gericht_id', '=', 'g.id')
      )
    )
    .orderBy('g.id')
    .execute();
  const werkzeug = geplant
    .flatMap((row) => {
      try {
        const namen: unknown = JSON.parse(row.werkzeuge);
        return Array.isArray(namen) ? namen.filter((n): n is string => typeof n === 'string') : [];
      } catch {
        return [];
      }
    })
    .find((name) => name.trim());
  await db.transaction().execute(async (trx) => {
    if (werkzeug) {
      const { id } = await trx
        .insertInto('essen.packliste_eintrag')
        .values({
          planung_id: planungId,
          werkzeug: packlisteSchluessel(werkzeug),
          name: werkzeug.trim(),
          gepackt: true,
        })
        .output('inserted.id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('essen.packliste_zuteilung')
        .values({ eintrag_id: id, mitglied_id: null, name: 'Küchenteam (Test)', gepackt: true })
        .execute();
    }
    const { id } = await trx
      .insertInto('essen.packliste_eintrag')
      .values({ planung_id: planungId, werkzeug: null, name: 'Gaskocher (Test)' })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('essen.packliste_zuteilung')
      .values({ eintrag_id: id, mitglied_id: null, name: 'Rover (Test)' })
      .execute();
  });
}

/** „Kochschürze (Test)“ for every member with access and a free name; the first one packed. */
async function fuerAlle(db: Db, planungId: number): Promise<void> {
  const name = 'Kochschürze (Test)';
  const da = await db
    .selectFrom('essen.packliste_eintrag')
    .select('id')
    .where('planung_id', '=', planungId)
    .where('werkzeug', 'is', null)
    .where('name', '=', name)
    .executeTakeFirst();
  if (da) return;
  const mitglieder = await db
    .selectFrom('essen.mitglied')
    .select('id')
    .where('planung_id', '=', planungId)
    .where('entzogen_am', 'is', null)
    .orderBy('id')
    .execute();
  await db.transaction().execute(async (trx) => {
    const { id } = await trx
      .insertInto('essen.packliste_eintrag')
      .values({ planung_id: planungId, werkzeug: null, name })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('essen.packliste_zuteilung')
      .values([
        ...mitglieder.map((mitglied, index) => ({
          eintrag_id: id,
          mitglied_id: mitglied.id,
          name: '',
          gepackt: index === 0,
        })),
        { eintrag_id: id, mitglied_id: null, name: 'Rover (Test)', gepackt: false },
      ])
      .execute();
  });
}
