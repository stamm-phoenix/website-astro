import { getDb } from './db';

const KONVERSATION = 'AAQkAGVzdHByZXZpZXdrb252ZXJzYXRpb24tdGVzdA==';
const NACHRICHT = 'AAkALgAAAAAAHYQDEapmEc2byACqAC-EWg0AdGVzdHByZXZpZXc=';
const USER = 'preview-test-user';

/**
 * Invented rows of the module „E-Mail“: a responsibility, a status and a read state of a conversation
 * that exists in no mailbox, so the tables have data in the previews without touching Exchange.
 * Each table is filled only while it is empty.
 */
export async function seedPreviewPostfach(now: Date = new Date()): Promise<void> {
  const db = getDb();
  const zustaendig = await db
    .selectFrom('postfach.zustaendigkeit')
    .select('postfach')
    .top(1)
    .executeTakeFirst();
  if (!zustaendig) {
    await db
      .insertInto('postfach.zustaendigkeit')
      .values({
        postfach: 'kontakt',
        konversation_id: KONVERSATION,
        login: 'leitung.test@example.invalid',
        name: 'Lea Leitung (Test)',
        von_login: 'vorstand.test@example.invalid',
        von_name: 'Vera Vorstand (Test)',
        betreff: 'Frage zur Gruppenstunde (Test)',
      })
      .execute();
  }
  const leser = await db.selectFrom('postfach.leser').select('postfach').top(1).executeTakeFirst();
  if (!leser) {
    await db
      .insertInto('postfach.leser')
      .values({
        postfach: 'kontakt',
        user_id: USER,
        login: 'leitung.test@example.invalid',
        gelesen_bis: new Date(now.getTime() - 14 * 86_400_000),
      })
      .execute();
  }
  const erledigt = await db
    .selectFrom('postfach.erledigung')
    .select('postfach')
    .top(1)
    .executeTakeFirst();
  if (!erledigt) {
    await db
      .insertInto('postfach.erledigung')
      .values({
        postfach: 'kontakt',
        konversation_id: KONVERSATION,
        status: 'erledigt',
        login: 'leitung.test@example.invalid',
        name: 'Lea Leitung (Test)',
        betreff: 'Frage zur Gruppenstunde (Test)',
      })
      .execute();
  }
  const gelesen = await db
    .selectFrom('postfach.gelesen')
    .select('postfach')
    .top(1)
    .executeTakeFirst();
  if (!gelesen) {
    await db
      .insertInto('postfach.gelesen')
      .values({ postfach: 'kontakt', user_id: USER, nachricht_id: NACHRICHT, gelesen: true })
      .execute();
  }
}
