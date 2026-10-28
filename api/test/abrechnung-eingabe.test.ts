import { HttpRequest, InvocationContext } from '@azure/functions';
import * as campflow from '../lib/campflow';
import * as eingaben from '../lib/abrechnung-eingabe';
import { AbrechnungEingabeEndpoint } from '../endpoints/intern-abrechnung-eingabe';
import assert from 'node:assert/strict';
import test from 'node:test';
import { emptySession, parseSession, validAbrechnungSession } from '../lib/abrechnung-session';
import type { AbrechnungSession } from '../lib/abrechnung-session';
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

test('session validation keeps the Kurzbeschreibung and accepts drafts of older pages', () => {
  const draft = emptySession();
  draft.kurzbeschreibung = {
    einleitung: 'Wir fahren gemeinsam ins Zeltlager.',
    tage: [
      {
        datum: '2026-05-24',
        bloecke: [
          { id: 'a1', von: '08:00', bis: '09:00', text: 'Frühstück' },
          { id: 'a2', von: '', bis: '', text: 'Hike' },
        ],
      },
    ],
  };
  assert.equal(validAbrechnungSession(draft), true);
  assert.deepEqual(parseSession(draft), draft);

  const older: Partial<AbrechnungSession> = emptySession();
  delete older.kurzbeschreibung;
  assert.equal(validAbrechnungSession(older), true);
  assert.deepEqual(parseSession(older).kurzbeschreibung, { einleitung: '', tage: [] });

  // Defect: a Zeitplan the page allows made the whole session too large to save
  const voll = emptySession();
  voll.kurzbeschreibung.tage = Array.from({ length: 31 }, (_tag, day) => ({
    datum: `2026-07-${String(day + 1).padStart(2, '0')}`,
    bloecke: Array.from({ length: 30 }, (_block, index) => ({
      id: `b${day}x${index}`,
      von: '08:00',
      bis: '09:00',
      text: '"'.repeat(200),
    })),
  }));
  assert.equal(validAbrechnungSession(voll), true);
  assert.equal(
    validAbrechnungSession({ ...voll, kjr: { ...voll.kjr, ort: 'x'.repeat(100_001) } }),
    false
  );

  const block = draft.kurzbeschreibung.tage[0].bloecke[0];
  const withBlock = (changed: object): unknown => ({
    ...draft,
    kurzbeschreibung: {
      ...draft.kurzbeschreibung,
      tage: [{ datum: '2026-05-24', bloecke: [{ ...block, ...changed }] }],
    },
  });
  assert.equal(validAbrechnungSession(withBlock({ von: '8 Uhr' })), false);
  assert.equal(validAbrechnungSession(withBlock({ bis: '24:00' })), false);
  assert.equal(validAbrechnungSession(withBlock({ id: '<x>' })), false);
  assert.equal(validAbrechnungSession(withBlock({ text: 'x'.repeat(201) })), false);
  assert.equal(
    validAbrechnungSession({
      ...draft,
      kurzbeschreibung: { ...draft.kurzbeschreibung, tage: [{ datum: 'Montag', bloecke: [] }] },
    }),
    false
  );
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
    const initial = await getAbrechnungEingabe('alice', 'evt_Test', '2099-01-01');
    assert.equal(initial.etag, null);
    const first = await saveAbrechnungEingabe(
      'alice',
      'evt_Test',
      'alice@example.test',
      draft,
      null,
      '2099-01-01'
    );
    assert.equal(
      (await getAbrechnungEingabe('alice', 'evt_Test', '2099-01-01')).session.zusatztag,
      true
    );
    assert.equal((await getAbrechnungEingabe('bob', 'evt_Test', '2099-01-01')).etag, null);
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
    assert.equal((await getAbrechnungEingabe('alice', 'evt_Test', '2000-01-01')).etag, null);
  }
);

dbTest(
  'a postponed Aktion refreshes its stored deadline before old entries can expire',
  async () => {
    const draft = emptySession();
    draft.zusatztag = true;
    await saveAbrechnungEingabe(
      'postponed',
      'evt_Postponed',
      'postponed@example.test',
      draft,
      null,
      '2000-01-01'
    );
    const extended = await getAbrechnungEingabe('postponed', 'evt_Postponed', '2099-01-01');
    assert.equal(extended.session.zusatztag, true);
    assert.equal(extended.deleteAfter, '2099-01-01');
    const unchanged = await getAbrechnungEingabe('postponed', 'evt_Postponed', '2099-01-01');
    assert.equal(unchanged.etag, extended.etag, 'unchanged dates do not invalidate another device');
    assert.equal(
      (await getAbrechnungEingabe('postponed', 'evt_Postponed', '2000-01-01')).etag,
      null
    );
  }
);

test('reading a draft obtains its current retention from CampFlow before touching stored data', async (t) => {
  t.mock.method(campflow, 'getCampflowEvents', async () => [
    { id: 'evt_Postponed', end_date: '2099-05-31' },
  ]);
  const read = t.mock.method(eingaben, 'getAbrechnungEingabe', async () => ({
    session: emptySession(),
    etag: null,
    savedAt: null,
    deleteAfter: null,
  }));
  const principal = {
    identityProvider: 'aad',
    userId: 'postponed',
    userDetails: 'postponed@example.test',
    userRoles: ['authenticated', 'team_leitende'],
  };
  const response = await AbrechnungEingabeEndpoint(
    new HttpRequest({
      url: 'https://example.test/api/intern/abrechnung/evt_Postponed/eingaben?deleteAfter=2000-01-01',
      method: 'GET',
      params: { id: 'evt_Postponed' },
      headers: {
        'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
      },
    }),
    new InvocationContext()
  );
  assert.equal(response.status, 200);
  assert.deepEqual(read.mock.calls[0].arguments, [
    'postponed',
    'evt_Postponed',
    abrechnungDeleteAfter('2099-05-31'),
  ]);
});

test('an undated Aktion can still read its draft without accepting an invented deadline', async (t) => {
  t.mock.method(campflow, 'getCampflowEvents', async () => [
    { id: 'evt_Undated', start_date: null, end_date: null },
  ]);
  const read = t.mock.method(eingaben, 'getAbrechnungEingabe', async () => ({
    session: emptySession(),
    etag: null,
    savedAt: null,
    deleteAfter: null,
  }));
  const principal = {
    identityProvider: 'aad',
    userId: 'undated',
    userDetails: 'undated@example.test',
    userRoles: ['authenticated', 'team_leitende'],
  };
  const response = await AbrechnungEingabeEndpoint(
    new HttpRequest({
      url: 'https://example.test/api/intern/abrechnung/evt_Undated/eingaben',
      method: 'GET',
      params: { id: 'evt_Undated' },
      headers: {
        'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
      },
    }),
    new InvocationContext()
  );
  assert.equal(response.status, 200);
  assert.deepEqual(read.mock.calls[0].arguments, ['undated', 'evt_Undated', null]);
});
