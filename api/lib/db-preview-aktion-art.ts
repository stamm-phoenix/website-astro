import { getDb } from './db';
const PREVIEW_ACTOR = 'preview';

/**
 * An invented CampFlow Aktion without KJR grant, so the table has a row; it matches no real
 * Aktion. Skipped if the preview has one already.
 */
export async function seedPreviewAktionenOhneZuschuss(): Promise<void> {
  const exists = await getDb()
    .selectFrom('organisation.aktion_ohne_zuschuss')
    .select('campflow_id')
    .executeTakeFirst();
  if (exists) return;
  await getDb()
    .insertInto('organisation.aktion_ohne_zuschuss')
    .values({ campflow_id: 'evt_PreviewExtern', created_by: PREVIEW_ACTOR })
    .execute();
}

/**
 * An invented CampFlow event that is no real Aktion, so the table has a row; it matches no real
 * event. Skipped if the preview has one already.
 */
export async function seedPreviewKeineAktionen(): Promise<void> {
  const exists = await getDb()
    .selectFrom('organisation.aktion_keine_aktion')
    .select('campflow_id')
    .executeTakeFirst();
  if (exists) return;
  await getDb()
    .insertInto('organisation.aktion_keine_aktion')
    .values({ campflow_id: 'evt_PreviewPulli', created_by: PREVIEW_ACTOR })
    .execute();
}
