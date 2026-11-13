import { retentionStart } from './anwesenheit';
import { STUFE_SLUGS } from './anwesenheit-model';
import { inTransaction } from './db';
import { dateToLocalParts } from './nikolaus-config';
const PREVIEW_ACTOR = 'preview';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Invented contents of the preview Termine, without names of children. */
const PREVIEW_NOTES = [
  'Knoten geübt und eine Seilbrücke gebaut.',
  'Geländespiel im Wald.',
  'Lagerfeuer mit Stockbrot.',
  'Erste Hilfe: Verbände anlegen.',
];

/** Index of the recent Termin that is seeded as cancelled, and of the one without notes. */
const PREVIEW_CANCELLED = 5;
const PREVIEW_WITHOUT_NOTES = 6;

/**
 * Weekly Termine of the last eight weeks per Stufe and two from before the retention period,
 * with invented contents, excused children and guests; one Termin is cancelled and one has no
 * notes. Members are stored as anonymized rows, so no CampFlow ID
 * gets into a preview. The dates count from the Monday of the current week, so a retry in the
 * same week adds only the Termine that are missing.
 */
export async function seedPreviewAttendance(now: Date = new Date()): Promise<void> {
  const today = new Date(`${dateToLocalParts(now).date}T00:00:00Z`).getTime();
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS;
  const expired = new Date(`${retentionStart(now)}T00:00:00Z`).getTime() - 14 * DAY_MS;
  for (const [offset, stufe] of Object.values(STUFE_SLUGS).entries()) {
    const recent = [...Array(8).keys()].map((week) => monday - (week + 1) * 7 * DAY_MS);
    const old = [expired, expired - 7 * DAY_MS];
    for (const [index, time] of [...recent, ...old].entries()) {
      const date = new Date(time + offset * DAY_MS).toISOString().slice(0, 10);
      // Termin and attendance in one transaction, so a run that stops halfway leaves no empty Termin
      await inTransaction(async (trx) => {
        const exists = await trx
          .selectFrom('gruppenstunde.meeting')
          .select('id')
          .where('stufe', '=', stufe)
          .where('date', '=', date)
          .executeTakeFirst();
        if (exists) return;
        const cancelled = index === PREVIEW_CANCELLED;
        const notes = cancelled
          ? 'Fällt aus wegen der Ferien.'
          : index === PREVIEW_WITHOUT_NOTES
            ? ''
            : PREVIEW_NOTES[(index + offset) % PREVIEW_NOTES.length];
        const { id } = await trx
          .insertInto('gruppenstunde.meeting')
          .values({ stufe, date, notes, cancelled, updated_by: PREVIEW_ACTOR })
          .output('inserted.id')
          .executeTakeFirstOrThrow();
        if (cancelled) return;
        const member = (excused: boolean) => ({
          meeting_id: id,
          guest: false,
          person_id: null,
          guest_name: null,
          excused,
        });
        const members = [
          ...Array.from({ length: 5 + ((index + offset) % 4) }, () => member(false)),
          ...Array.from({ length: 1 + (index % 2) }, () => member(true)),
        ];
        const guests =
          index % 3 === 0
            ? [
                {
                  meeting_id: id,
                  guest: true,
                  person_id: null,
                  guest_name: index < recent.length ? `Testgast ${index + 1}` : null,
                },
              ]
            : [];
        await trx
          .insertInto('gruppenstunde.attendance')
          .values([...members, ...guests])
          .execute();
      });
    }
  }
}
