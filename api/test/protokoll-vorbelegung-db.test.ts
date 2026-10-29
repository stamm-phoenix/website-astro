import assert from 'node:assert/strict';
import { getDb } from '../lib/db';
import { neuerInhalt } from '../lib/protokoll-editor-model';
import { vorbelegungFuer } from '../lib/protokoll-vorbelegung';
import { dbTest } from './fixtures/database';

const ANNA = 'anna.autorin@stamm-phoenix.de';

dbTest(
  'the prefill starts after the last approved minutes and takes time and place from them',
  async () => {
    const db = getDb();
    const meeting = (date: string, notes: string) =>
      db.insertInto('gruppenstunde.meeting').values({ stufe: 'Wölflinge', date, notes }).execute();
    const minutes = (title: string, date: string, status: 'entwurf' | 'freigegeben') =>
      db
        .insertInto('protokoll.protokoll')
        .values({
          title,
          meeting_date: date,
          status,
          content: JSON.stringify(
            neuerInhalt(() => 'x', {}, { naechsteSitzung: { uhrzeit: '19:30', ort: title } })
          ),
          created_by: ANNA,
          updated_by: ANNA,
        })
        .execute();
    await meeting('2026-09-20', 'zu alt');
    await meeting('2026-10-07', 'Lagerfeuer');
    await meeting('2026-10-20', 'nach der Sitzung');
    await minutes('Pfarrheim', '2026-09-30', 'freigegeben');
    // a newer draft is no reference for the period
    await minutes('Entwurf', '2026-10-13', 'entwurf');

    const vorlage = await vorbelegungFuer('2026-10-14');

    assert.equal(vorlage.texte['Wölflinge'], '- 07.10.: 0 Kinder. Lagerfeuer');
    assert.deepEqual(vorlage.naechsteSitzung, { uhrzeit: '19:30', ort: 'Pfarrheim' });
  }
);
