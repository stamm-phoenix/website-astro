import { randomBytes } from 'node:crypto';
import { CONFIG } from './config';
import { getDb } from './db';

/**
 * The preview test account becomes a member of the invented „Sommerlager (Test)“ with its token
 * for the Leitendenbereich, so „Meine Essensplanungen“ lists it (`docs/essensplanung.md`, „Zugang
 * aus dem Leitendenbereich“). Fills only what is missing, like the other seed steps.
 */
export async function seedPreviewEssensplanungLeitung(): Promise<void> {
  const db = getDb();
  const email = CONFIG.staff.previewOnlyLogins[0]?.toLowerCase();
  if (!email) return;
  const planung = await db
    .selectFrom('essen.planung')
    .select('id')
    .where('name', '=', 'Sommerlager (Test)')
    .executeTakeFirst();
  if (!planung) return;
  let mitglied = await db
    .selectFrom('essen.mitglied')
    .select('id')
    .where('planung_id', '=', planung.id)
    .where('email', '=', email)
    .executeTakeFirst();
  mitglied ??= await db
    .insertInto('essen.mitglied')
    .values({ planung_id: planung.id, name: 'Vorschau-Testkonto', email, rolle: 'bearbeiten' })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  const link = await db
    .selectFrom('essen.leitung_link')
    .select('mitglied_id')
    .where('mitglied_id', '=', mitglied.id)
    .executeTakeFirst();
  if (link) return;
  await db
    .insertInto('essen.leitung_link')
    .values({ mitglied_id: mitglied.id, token: randomBytes(32).toString('base64url') })
    .execute();
}
