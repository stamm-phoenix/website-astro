import { getDb } from './db';

/**
 * Invented receipts for the „Sommerlager (Test)“ of a PR preview (`docs/essensplanung.md`,
 * Belege): paid by a member and by someone else, one of them paid back, all without a photo.
 * Fills only what is missing, like the other seed steps.
 */
export async function seedPreviewEssensplanungBelege(): Promise<void> {
  const db = getDb();
  const planung = await db
    .selectFrom('essen.planung')
    .select('id')
    .where('name', '=', 'Sommerlager (Test)')
    .executeTakeFirst();
  if (!planung) return;
  const vorhanden = await db
    .selectFrom('essen.beleg')
    .select('id')
    .where('planung_id', '=', planung.id)
    .top(1)
    .executeTakeFirst();
  if (vorhanden) return;
  const mitglied = await db
    .selectFrom('essen.mitglied')
    .select('id')
    .where('planung_id', '=', planung.id)
    .where('entzogen_am', 'is', null)
    .orderBy('id')
    .executeTakeFirst();
  const heute = new Date();
  const tag = (minus: number) =>
    new Date(heute.getTime() - minus * 86_400_000).toISOString().slice(0, 10);
  const vonMitglied = mitglied
    ? { bezahlt_von_mitglied_id: mitglied.id, bezahlt_von_text: '' }
    : { bezahlt_von_mitglied_id: null, bezahlt_von_text: 'Küchenteam (Test)' };
  await db
    .insertInto('essen.beleg')
    .values([
      {
        planung_id: planung.id,
        datum: tag(6),
        betrag_cent: 8735,
        haendler: 'Großmarkt (Test)',
        notiz: 'Grundeinkauf',
        ...vonMitglied,
        erstattet: true,
        erstattet_am: new Date(heute.getTime() - 2 * 86_400_000),
        erstattet_von_mitglied_id: mitglied?.id ?? null,
        angelegt_von_mitglied_id: mitglied?.id ?? null,
      },
      {
        planung_id: planung.id,
        datum: tag(3),
        betrag_cent: 2399,
        haendler: 'Bäckerei (Test)',
        ...vonMitglied,
        angelegt_von_mitglied_id: mitglied?.id ?? null,
      },
      {
        planung_id: planung.id,
        datum: tag(2),
        betrag_cent: 1450,
        haendler: 'Gas für den Kocher (Test)',
        bezahlt_von_mitglied_id: null,
        bezahlt_von_text: 'Rover (Test)',
        angelegt_von_mitglied_id: mitglied?.id ?? null,
      },
    ])
    .execute();
}
