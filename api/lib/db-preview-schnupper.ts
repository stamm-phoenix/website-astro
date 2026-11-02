import { getDb } from './db';
import type { SchnupperAnfrageTable } from './db-schema-schnupper';
import type { Insertable } from 'kysely';

const ACTOR = 'preview';

/** `YYYY-MM-DD` some days from `now`. */
function inDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Invented Schnupperstunden-Anfragen (#139) in every state: two open, one confirmed and one
 * cancelled. Skipped if the preview has some already.
 */
export async function seedPreviewSchnupperanfragen(now: Date = new Date()): Promise<void> {
  const db = getDb();
  const vorhanden = await db
    .selectFrom('organisation.schnupper_anfrage')
    .select('id')
    .top(1)
    .executeTakeFirst();
  if (vorhanden) return;
  const rows: Insertable<SchnupperAnfrageTable>[] = [
    {
      alter_jahre: 8,
      stufe: 'woelflinge',
      kind_vorname: 'Mia (Test)',
      kontakt_name: 'Erika Muster (Test)',
      email: 'erika.muster@example.invalid',
      telefon: '0170 1234567',
      wunschzeit: 'Gern nach den Herbstferien, dienstags passt gut.',
      nachricht: 'Mia war noch nie bei den Pfadfindern und ist etwas schüchtern.',
      termin_datum: null,
      termin_zeit: null,
    },
    {
      alter_jahre: 14,
      stufe: 'unklar',
      kontakt_name: 'Jonas Beispiel (Test)',
      email: 'jonas.beispiel@example.invalid',
      wunschzeit: 'So bald wie möglich',
      termin_datum: null,
      termin_zeit: null,
    },
    {
      alter_jahre: 11,
      stufe: 'jupfis',
      kind_vorname: 'Lena (Test)',
      kontakt_name: 'Petra Probe (Test)',
      email: 'petra.probe@example.invalid',
      wunschzeit: 'Nächste Woche',
      status: 'bestaetigt',
      termin_datum: inDays(now, 7),
      termin_zeit: '17:30',
      termin_ort: 'Pfarrheim',
      antwort: 'Bitte feste Schuhe anziehen, wir sind draußen.',
      antwort_mail: true,
      bearbeitet_von: ACTOR,
      bearbeitet_am: now,
    },
    {
      alter_jahre: 17,
      stufe: 'rover',
      kontakt_name: 'Tim Test (Test)',
      email: 'tim.test@example.invalid',
      wunschzeit: 'Im Dezember',
      status: 'abgesagt',
      termin_datum: null,
      termin_zeit: null,
      antwort: 'Die Rover machen im Dezember Pause. Melde dich gern im Januar wieder.',
      antwort_mail: false,
      bearbeitet_von: ACTOR,
      bearbeitet_am: now,
    },
  ];
  await db.insertInto('organisation.schnupper_anfrage').values(rows).execute();
}
