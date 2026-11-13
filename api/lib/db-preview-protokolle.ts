import { neuerInhalt } from './protokoll-editor-model';
import { inTransaction } from './db';
import { dateToLocalParts } from './nikolaus-config';
const PREVIEW_ACTOR = 'preview';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Invented metadata only; never import SharePoint production columns into previews. */
export async function seedPreviewProtokolle(): Promise<void> {
  await inTransaction(async (trx) => {
    await trx
      .updateTable('organisation.protokoll_cutover')
      .set({ mode: 'sql', sql_started: true })
      .where('id', '=', 1)
      .execute();
    if (
      !(await trx
        .selectFrom('organisation.protokoll_import')
        .select('drive_id')
        .where('drive_id', '=', '*preview*')
        .executeTakeFirst())
    ) {
      await trx
        .insertInto('organisation.protokoll_import')
        .values({ drive_id: '*preview*' })
        .execute();
    }
    if (
      !(await trx
        .selectFrom('organisation.protokoll')
        .select('item_id')
        .where('drive_id', '=', 'preview-documents')
        .where('item_id', '=', 'preview-protokoll')
        .executeTakeFirst())
    ) {
      await trx
        .insertInto('organisation.protokoll')
        .values({
          drive_id: 'preview-documents',
          item_id: 'preview-protokoll',
          fields: JSON.stringify({ Status: 'Review', ErstelltVon: 'alex@example.test' }),
          legacy_fields: null,
          legacy_etag: null,
        })
        .execute();
    }
    if (
      !(await trx
        .selectFrom('organisation.protokoll_content_version')
        .select('item_id')
        .where('drive_id', '=', 'preview-documents')
        .where('item_id', '=', 'preview-protokoll')
        .executeTakeFirst())
    ) {
      await trx
        .insertInto('organisation.protokoll_content_version')
        .values({
          drive_id: 'preview-documents',
          item_id: 'preview-protokoll',
          ctag: '"c:{preview-protokoll},1"',
          content_version: 'docx-word-sha256:' + '0'.repeat(64),
        })
        .execute();
    }
  });
}

/**
 * Minutes in the editor with invented content, so the editor and the live view have something
 * to show. Skipped if the preview has some already.
 */
export async function seedPreviewProtokollEditor(now: Date = new Date()): Promise<void> {
  await seedPreviewProtokollEntwurf(now);
  await seedPreviewProtokollReview(now);
}

const REVIEW_TITLE = 'Stavo-Sitzung (Testdaten)';

/** Minutes waiting for the review, so testers can try approving and sending them back. */
async function seedPreviewProtokollReview(now: Date): Promise<void> {
  await inTransaction(async (trx) => {
    const exists = await trx
      .selectFrom('protokoll.protokoll')
      .select('id')
      .where('title', '=', REVIEW_TITLE)
      .executeTakeFirst();
    if (exists) return;
    let n = 0;
    const inhalt = neuerInhalt(() => `seed-review-${++n}`, {
      sitzungsleitung: [{ login: '', name: 'Vera Vorstand' }],
      protokollant: [{ login: '', name: 'Paula Protokoll' }],
      beginn: '20:00',
      ende: '21:00',
      teilnehmende: [
        { login: '', name: 'Vera Vorstand', status: 'anwesend' },
        { login: '', name: 'Volker Vorstand', status: 'anwesend' },
      ],
    });
    inhalt.punkte[1].text = 'Kurzer Rückblick auf das Sommerlager.\n- Alles gut gelaufen';
    // Approving the minutes creates this task in the project of the item (#277, step 3)
    const project = await trx
      .selectFrom('organisation.project')
      .select(['id', 'title'])
      .where('title', '=', 'Herbstaktion')
      .executeTakeFirst();
    inhalt.punkte[2].projekt = project ? { id: project.id, titel: project.title } : null;
    inhalt.punkte[2].aufgaben = [
      {
        id: `seed-review-${++n}`,
        titel: 'Einladung zur Herbstaktion verschicken (Testdaten)',
        zustaendig: [{ login: '', name: 'Volker Vorstand' }],
        faellig: dateToLocalParts(new Date(now.getTime() + 10 * DAY_MS)).date,
      },
    ];
    const date = dateToLocalParts(new Date(now.getTime() - 9 * DAY_MS)).date;
    await trx
      .insertInto('protokoll.protokoll')
      .values({
        title: REVIEW_TITLE,
        meeting_date: date,
        status: 'review',
        content: JSON.stringify(inhalt),
        created_by: PREVIEW_ACTOR,
        updated_by: PREVIEW_ACTOR,
        submitted_at: now,
        submitted_by: PREVIEW_ACTOR,
      })
      .execute();
  });
}

async function seedPreviewProtokollEntwurf(now: Date): Promise<void> {
  await inTransaction(async (trx) => {
    const exists = await trx
      .selectFrom('protokoll.protokoll')
      .select('id')
      .where('title', '!=', REVIEW_TITLE)
      .executeTakeFirst();
    if (exists) return;
    let n = 0;
    const inhalt = neuerInhalt(() => `seed-${++n}`, {
      sitzungsleitung: [
        { login: '', name: 'Vera Vorstand' },
        { login: '', name: 'Volker Vorstand' },
      ],
      protokollant: [{ login: '', name: 'Paula Protokoll' }],
      beginn: '19:30',
      ende: '21:15',
      teilnehmende: [
        { login: '', name: 'Lea Leiterin', status: 'anwesend' },
        { login: '', name: 'Max Muster', status: 'anwesend' },
        { login: '', name: 'Tom Test', status: 'entschuldigt' },
      ],
      externe: 'Elternbeirat (Testdaten)',
    });
    const [stufen, reflexion, planung] = inhalt.punkte;
    stufen.unterpunkte[0].text =
      'Gruppenstunde zum Thema Erste Hilfe, **12 Kinder** da.\n- Neue Jacken bestellt\n- Ausflug geplant';
    reflexion.text =
      'Der Stammestag war gut besucht. Nächstes Mal _früher_ mit dem Aufbau anfangen.\n\n' +
      '1. Aufbau ab 9 Uhr\n2. Mehr Helfende für die Küche\n\n- [x] Fotos hochgeladen\n- [ ] Dankesmail';
    planung.titel = 'Pfingstlager (Testdaten)';
    planung.aktion = {
      id: 'evt_preview',
      titel: 'Pfingstlager (Testdaten)',
      start: '2027-05-14',
      ende: '2027-05-17',
    };
    planung.text = 'Zeltplatz ist reserviert, Anzahlung steht noch aus.';
    planung.aufgaben = [
      {
        id: `seed-${++n}`,
        titel: 'Anzahlung für den Zeltplatz überweisen',
        zustaendig: [{ login: '', name: 'Vera Vorstand' }],
        faellig: dateToLocalParts(new Date(now.getTime() + 7 * DAY_MS)).date,
      },
    ];
    planung.termine = [
      {
        id: `seed-${++n}`,
        titel: 'Vortreffen Pfingstlager',
        datum: dateToLocalParts(new Date(now.getTime() + 21 * DAY_MS)).date,
        uhrzeit: '18:00',
        ort: 'Stammesheim',
        zustaendig: [{ login: '', name: 'Lea Leiterin' }],
      },
    ];
    inhalt.naechsteSitzung = {
      datum: dateToLocalParts(new Date(now.getTime() + 14 * DAY_MS)).date,
      uhrzeit: '19:30',
      ort: 'Stammesheim',
    };
    const content = JSON.stringify(inhalt);
    const date = dateToLocalParts(new Date(now.getTime() - 2 * DAY_MS)).date;
    const { id } = await trx
      .insertInto('protokoll.protokoll')
      .values({
        title: 'Leitendenrunde (Testdaten)',
        meeting_date: date,
        content,
        created_by: PREVIEW_ACTOR,
        updated_by: PREVIEW_ACTOR,
      })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('protokoll.revision')
      .values({
        protokoll_id: id,
        title: 'Leitendenrunde (Testdaten)',
        meeting_date: date,
        content,
        reason: 'speichern',
        saved_at: now,
        saved_by: PREVIEW_ACTOR,
      })
      .execute();
  });
}
