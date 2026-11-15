import { seedPreviewVerleih } from '../lib/db-preview-verleih';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import { dbTest } from './fixtures/database';
import { getDb } from '../lib/db';
import { createInventarArtikel, getInventar } from '../lib/inventur';
import { saveVerleih } from '../lib/verleih-schreiben';
import { ValidationError } from '../lib/validation/errors';
import { validateVerleihAktion } from '../lib/validation/verleih';

test('the removed approval action is rejected', () => {
  assert.throws(() => validateVerleihAktion({ aktion: 'genehmigen' }), ValidationError);
});
dbTest(
  'the forward migration archives old requests, retains confirmed loans and removes obsolete unsent mail',
  async () => {
    const db = getDb();
    const materialId = await createInventarArtikel(
      {
        bezeichnung: 'Zelt (Test)',
        kategorie: 'zelt',
        einheit: 'Stück',
        lagerort: '',
        zustand: 'gut',
        zubehoer: '',
        fehlend: '',
        notizen: '',
        varianten: [{ id: null, bezeichnung: '', bestand: 2 }],
      },
      'test'
    );
    const a = (await getInventar()).find((a) => a.id === materialId)!;
    const values = {
      antragsteller: 'test@example.invalid',
      entleiher: 'Rover',
      kontakt: '',
      verantwortlich: '',
      von: '2027-07-01',
      bis: '2027-07-03',
      notizen: '',
    };
    const pending = await db
      .insertInto('organisation.verleih')
      .values({ ...values, status: 'antrag' })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    const approved = await db
      .insertInto('organisation.verleih')
      .values({ ...values, status: 'genehmigt' })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    for (const id of [pending.id, approved.id])
      await db
        .insertInto('organisation.verleih_position')
        .values({
          verleih_id: id,
          variante_id: a.varianten[0].id,
          bezeichnung: a.bezeichnung,
          menge: 1,
        })
        .execute();
    await db
      .insertInto('organisation.verleih_mail')
      .values({
        verleih_id: pending.id,
        empfaenger: 'test@example.invalid',
        betreff: 'Neuer Ausleihantrag',
        text: 'Bitte genehmigen.',
      })
      .execute();
    await sql
      .raw(readFileSync(resolve(__dirname, '../../migrations/0090_verleih_direkt.sql'), 'utf8'))
      .execute(db);
    const rows = await db.selectFrom('organisation.verleih').select(['id', 'status']).execute();
    assert.equal(rows.find((r) => r.id === pending.id)?.status, 'zurueckgezogen');
    assert.equal(rows.find((r) => r.id === approved.id)?.status, 'ausgegeben');
    assert.equal(
      (await db.selectFrom('organisation.verleih_mail').selectAll().execute()).length,
      0
    );
    await seedPreviewVerleih();
    await seedPreviewVerleih();
    const previewMails = await db.selectFrom('organisation.verleih_mail').selectAll().execute();
    assert.equal(previewMails.length, 1);
    assert.equal(previewMails[0].gesendet, true);
    await assert.rejects(
      saveVerleih(
        { ...values, positionen: [{ varianteId: a.varianten[0].id, menge: 2 }] },
        'test@example.invalid'
      ),
      ValidationError
    );
  }
);
