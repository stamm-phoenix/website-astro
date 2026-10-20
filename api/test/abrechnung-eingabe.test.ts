import assert from 'node:assert/strict';
import test from 'node:test';
import { emptySession, parseSession, validAbrechnungSession } from '../lib/abrechnung-session';
import {
  abrechnungDeleteAfter,
  getAbrechnungEingabe,
  saveAbrechnungEingabe,
} from '../lib/abrechnung-eingabe';
import { VersionConflictError, getDb } from '../lib/db';
import { dbTest } from './fixtures/database';

test('session validation preserves complete drafts and rejects destructive malformed writes', () => {
  const draft = emptySession();
  draft.plz = { person1: '83620' };
  draft.betraege = { receipt1: -1234 };
  draft.extra.push({
    id: 'extra-1',
    firstName: 'Erika',
    lastName: 'Muster',
    gender: 'w',
    age: 24,
    plz: '83620',
    ort: 'Musterort',
    herkunft: 'landkreis',
    betreuer: true,
  });
  assert.equal(validAbrechnungSession(draft), true);
  assert.deepEqual(parseSession(draft), draft);
  assert.equal(validAbrechnungSession({}), false);
  assert.equal(validAbrechnungSession({ ...draft, extra: [{ id: 'extra-2' }] }), false);
  assert.equal(validAbrechnungSession({ ...draft, betraege: { receipt1: '12,34' } }), false);
  assert.equal(validAbrechnungSession({ ...draft, surprise: true }), false);
  assert.equal(
    validAbrechnungSession({ ...draft, kjr: { ...draft.kjr, ort: 'x'.repeat(100_001) } }),
    false
  );
  assert.equal(validAbrechnungSession({ ...draft, plz: [] }), false);
});

test('retention keeps calendar months including leap years', () => {
  assert.equal(abrechnungDeleteAfter('2026-07-31'), '2026-11-30');
  assert.equal(abrechnungDeleteAfter('2023-10-31'), '2024-02-29');
  assert.equal(abrechnungDeleteAfter('2026-11-30'), '2027-03-28');
});

dbTest(
  'drafts are isolated by account and stale devices cannot overwrite or resurrect them',
  async () => {
    const draft = emptySession();
    draft.zusatztag = true;
    const initial = await getAbrechnungEingabe('alice', 'evt_Test');
    assert.equal(initial.etag, null);
    const first = await saveAbrechnungEingabe(
      'alice',
      'evt_Test',
      'alice@example.test',
      draft,
      null,
      '2099-01-01'
    );
    assert.equal((await getAbrechnungEingabe('alice', 'evt_Test')).session.zusatztag, true);
    assert.equal((await getAbrechnungEingabe('bob', 'evt_Test')).etag, null);
    await assert.rejects(
      () =>
        saveAbrechnungEingabe('alice', 'evt_Test', 'alice@example.test', draft, null, '2099-01-01'),
      VersionConflictError
    );
    const reset = await saveAbrechnungEingabe(
      'alice',
      'evt_Test',
      'alice@example.test',
      emptySession(),
      first.etag,
      '2099-01-01'
    );
    assert.notEqual(reset.etag, first.etag);
    await assert.rejects(
      () =>
        saveAbrechnungEingabe(
          'alice',
          'evt_Test',
          'alice@example.test',
          draft,
          first.etag,
          '2099-01-01'
        ),
      VersionConflictError
    );
    await getDb()
      .updateTable('organisation.abrechnung_eingabe')
      .set({ delete_after: new Date('2000-01-01') })
      .where('user_id', '=', 'alice')
      .execute();
    assert.equal((await getAbrechnungEingabe('alice', 'evt_Test')).etag, null);
  }
);
