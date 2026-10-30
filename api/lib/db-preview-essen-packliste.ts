import { getDb } from './db';
import { packlisteSchluessel } from './essen-packliste-model';

/**
 * An invented packing list for the „Sommerlager (Test)“ of a PR preview (`docs/essensplanung.md`,
 * Packliste): one tool of a planned dish packed, one entry of its own. Fills only what is
 * missing, like the other seed steps.
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
  if (vorhanden) return;
  const geplant = await db
    .selectFrom('essen.gericht as g')
    .select('g.werkzeuge')
    .where('g.planung_id', '=', planung.id)
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
      await trx
        .insertInto('essen.packliste_eintrag')
        .values({
          planung_id: planung.id,
          werkzeug: packlisteSchluessel(werkzeug),
          name: werkzeug.trim(),
          gepackt: true,
          zustaendig_mitglied_id: null,
          zustaendig_text: 'Küchenteam (Test)',
        })
        .execute();
    }
    await trx
      .insertInto('essen.packliste_eintrag')
      .values({
        planung_id: planung.id,
        werkzeug: null,
        name: 'Gaskocher (Test)',
        zustaendig_mitglied_id: null,
        zustaendig_text: 'Rover (Test)',
      })
      .execute();
  });
}
