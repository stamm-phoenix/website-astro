import { validateAbstimmung } from './abstimmung-schema';
import { createAbstimmung, queueAbstimmungEinladungen, voteAsStaff } from './abstimmungen';
import { getDb } from './db';

/** The option IDs of an Abstimmung in their order. */
async function previewOptionen(id: number): Promise<number[]> {
  const rows = await getDb()
    .selectFrom('abstimmung.optionen')
    .select('id')
    .where('abstimmung_id', '=', id)
    .orderBy('position')
    .execute();
  return rows.map((option) => option.id);
}

/**
 * Two invented Abstimmungen with a few answers and an invitation, so every table and setting
 * of the Abstimmungen has rows: an open Terminfindung with „Vielleicht“ and a question whose
 * answers only the organizer sees. Created by an invented leader: real logins of the preview see
 * them as participants and create their own to manage. Each one is skipped if it exists already.
 */
export async function seedPreviewAbstimmungen(): Promise<void> {
  const db = getDb();
  const organisator = { login: 'vorschau@example.test', name: 'Vroni Vorschau', adressen: [] };
  const theo = { login: 'theo.test@example.test', name: 'Theo Test', adressen: [] };
  const vorhanden = async (titel: string): Promise<boolean> =>
    Boolean(
      await db
        .selectFrom('abstimmung.abstimmung')
        .select('id')
        .where('titel', '=', titel)
        .executeTakeFirst()
    );

  const termin = 'Termin für die Weihnachtsfeier (Test)';
  if (!(await vorhanden(termin))) {
    const id = await createAbstimmung(
      validateAbstimmung({
        titel: termin,
        beschreibung: 'Erfundene Testdaten der Preview. Bitte alle Termine wählen, die gehen.',
        vielleichtErlaubt: true,
        optionen: [
          { text: 'Fr, 11.12. ab 19 Uhr' },
          { text: 'Sa, 12.12. ab 18 Uhr' },
          { text: 'Fr, 18.12. ab 19 Uhr' },
        ],
      }),
      organisator
    );
    const [erste, zweite, dritte] = await previewOptionen(id);
    await voteAsStaff(
      id,
      { ...organisator, adressen: [organisator.login] },
      { gewaehlt: [erste, dritte] }
    );
    await voteAsStaff(id, theo, { gewaehlt: [zweite], vielleicht: [dritte] });
    await queueAbstimmungEinladungen(id, organisator.login, [
      { email: 'alt.leitung@example.test', name: 'Alma Altleitung', familie: false },
    ]);
    // Sent without a mail: the preview never mails invented addresses
    await db
      .updateTable('abstimmung.teilnahme')
      .set({ mail_status: 'gesendet', eingeladen_am: new Date().toISOString() })
      .where('abstimmung_id', '=', id)
      .where('mail_status', '=', 'offen')
      .execute();
  }

  const ziel = 'Ziel für das Leitendenwochenende (Test)';
  if (!(await vorhanden(ziel))) {
    const id = await createAbstimmung(
      validateAbstimmung({
        titel: ziel,
        beschreibung: 'Erfundene Testdaten der Preview. Höchstens zwei Ziele wählen.',
        maxAuswahl: 2,
        sichtbarkeit: 'anonym',
        optionen: [
          { text: 'Zeltplatz am See' },
          { text: 'Hütte in den Bergen' },
          { text: 'Stadt' },
        ],
      }),
      organisator
    );
    const [see, huette] = await previewOptionen(id);
    await voteAsStaff(id, theo, { gewaehlt: [see, huette] });
  }
}
