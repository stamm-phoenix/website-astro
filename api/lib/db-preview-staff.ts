import { sql } from 'kysely';
import { getDb } from './db';
const PREVIEW_ACTOR = 'preview';

/** Invented Altleitende and others to pick in the minutes (#301); skipped if there are some. */
export async function seedPreviewPersonen(): Promise<void> {
  const exists = await getDb().selectFrom('organisation.person').select('id').executeTakeFirst();
  if (exists) return;
  await getDb()
    .insertInto('organisation.person')
    .values([
      { name: 'Anna Altleiterin', gruppe: 'altleitende', updated_by: PREVIEW_ACTOR },
      { name: 'Otto Ehemalig', gruppe: 'altleitende', updated_by: PREVIEW_ACTOR },
      { name: 'Erika Elternbeirat', gruppe: 'weitere', updated_by: PREVIEW_ACTOR },
      { name: 'Ingo Inaktiv', gruppe: 'weitere', aktiv: false, updated_by: PREVIEW_ACTOR },
    ])
    .execute();
}

/**
 * Favorites of an invented account, so the table has a row; real logins of the preview save
 * their own. Skipped if the preview has favorites already.
 */
export async function seedPreviewStaffFavorites(): Promise<void> {
  const exists = await getDb()
    .selectFrom('organisation.staff_favorites')
    .select('user_id')
    .executeTakeFirst();
  if (exists) return;
  await getDb()
    .insertInto('organisation.staff_favorites')
    .values({
      user_id: 'preview-favoriten',
      login: 'vorschau@example.test',
      modules: JSON.stringify(['/leitendenbereich/aufgaben', '/leitendenbereich/aktionen']),
    })
    .execute();
}

/**
 * Recently used areas of an invented account, so the table has a row; real logins of the preview
 * collect their own. Skipped if the preview has some already.
 */
export async function seedPreviewStaffRecent(): Promise<void> {
  const exists = await getDb()
    .selectFrom('organisation.staff_recent')
    .select('user_id')
    .executeTakeFirst();
  if (exists) return;
  await getDb()
    .insertInto('organisation.staff_recent')
    .values({
      user_id: 'preview-zuletzt',
      login: 'vorschau@example.test',
      modules: JSON.stringify(['/leitendenbereich/belege', '/leitendenbereich/fotos']),
    })
    .execute();
}

/**
 * One invented account that has seen an early changelog entry, so the table has a row; real
 * logins of the preview start without one and see every entry as new. Skipped if the preview
 * has some already.
 */
export async function seedPreviewStaffChangelogSeen(): Promise<void> {
  const exists = await getDb()
    .selectFrom('organisation.staff_changelog_seen')
    .select('user_id')
    .executeTakeFirst();
  if (exists) return;
  await getDb()
    .insertInto('organisation.staff_changelog_seen')
    .values({
      user_id: 'preview-neuigkeiten',
      login: 'vorschau@example.test',
      last_seen_id: '2026-09-25-01-leitendenbereich',
    })
    .execute();
}

/** Invented personal Abrechnung draft; no real participant data. */
export async function seedPreviewAbrechnungEingabe(): Promise<void> {
  const db = getDb();
  const exists = await db
    .selectFrom('organisation.abrechnung_eingabe')
    .select('user_id')
    .executeTakeFirst();
  if (exists) return;
  await db
    .insertInto('organisation.abrechnung_eingabe')
    .values({
      user_id: 'preview-abrechnung',
      event_id: 'evt_Preview26',
      login: 'vorschau@example.test',
      session: JSON.stringify({
        zusatztag: false,
        excluded: {},
        extra: [],
        betreuer: {},
        plz: {},
        kjr: { ort: 'Musterort', plz: '83620', beginn: '', ende: '' },
        leihgebuehren: {},
        deckblatt: { vorkalkulation: '', kalkulation: '' },
        betraege: {},
      }),
      delete_after: sql<Date>`DATEADD(month, 4, CONVERT(date, SYSUTCDATETIME()))`,
    })
    .execute();
}

/** One invented person who writes the minutes in Markdown; everyone else has the default. */
export async function seedPreviewStaffSettings(): Promise<void> {
  const exists = await getDb()
    .selectFrom('organisation.staff_settings')
    .select('user_id')
    .executeTakeFirst();
  if (exists) return;
  await getDb()
    .insertInto('organisation.staff_settings')
    .values({
      user_id: 'preview-einstellungen',
      login: 'vorschau@example.test',
      settings: JSON.stringify({ protokollText: 'markdown' }),
    })
    .execute();
}
