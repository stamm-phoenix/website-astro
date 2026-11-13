import { randomBytes } from 'node:crypto';
import { CONFIG } from './config';
import { getDb } from './db';
import { hashToken, neuesToken } from './essen-zugang';

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
  // A link from the mail nobody gets; „Meine Planungen“ and „Neuer Link“ replace it
  mitglied ??= await db
    .insertInto('essen.mitglied')
    .values({
      planung_id: planung.id,
      name: 'Vorschau-Testkonto',
      email,
      rolle: 'bearbeiten',
      token_hash: hashToken(neuesToken()),
    })
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  // Seeded before it had one; a withdrawn member stays withdrawn
  await db
    .updateTable('essen.mitglied')
    .set({ token_hash: hashToken(neuesToken()) })
    .where('id', '=', mitglied.id)
    .where('token_hash', 'is', null)
    .where('entzogen_am', 'is', null)
    .execute();
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
