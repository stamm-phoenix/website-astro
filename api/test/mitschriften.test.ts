import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import * as blobStorage from '../lib/blob-storage';
import { getDb } from '../lib/db';
import { seedPreviewMitschriften } from '../lib/db-preview';
import {
  checkAuftraege,
  cleanupStaleAuftraege,
  getMitschrift,
  getMitschriftenOverview,
  warnBefore,
} from '../lib/mitschriften';
import type { MitschriftDetail, MitschriftNotizen } from '../lib/mitschriften-model';
import * as notizen from '../lib/mitschriften-notizen';
import { toNotizen, transcriptText } from '../lib/mitschriften-notizen';
import * as speech from '../lib/mitschriften-speech';
import { parseTranscriptionResult } from '../lib/mitschriften-speech';
import {
  ValidationError,
  validateAuftrag,
  validateLiveAbschnitte,
  validateNotizen,
} from '../lib/pflege-validation';
import {
  MitschriftAbschnitt,
  MitschriftAbschnitteDelete,
  MitschriftAbschnitteMerge,
  MitschriftAuftraege,
  MitschriftAuftrag,
  MitschriftCheck,
  MitschriftFinish,
  MitschriftItem,
  MitschriftLive,
  MitschriftNotizen as NotizenEndpoint,
  MitschriftSprecher,
  MitschriftSprecherMerge,
  MitschriftenCleanup,
  MitschriftenCollection,
} from '../endpoints/intern-mitschriften';
import { dbTest } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

function request(method: string, params: Record<string, string> = {}, body?: unknown): HttpRequest {
  return new HttpRequest({
    url: 'https://example.test/api/intern/pflege/mitschriften',
    method,
    headers: {
      'content-type': 'application/json',
      'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
    },
    params,
    ...(body === undefined ? {} : { body: { string: JSON.stringify(body) } }),
  });
}

function quietContext(t: TestContext): InvocationContext {
  const context = new InvocationContext({ functionName: 'mitschriften-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return context;
}

/** Blob Storage and Azure Speech in memory; records what was deleted. */
function mockAzure(t: TestContext) {
  const deletedBlobs: string[] = [];
  const deletedJobs: string[] = [];
  const blobs = new Set<string>();
  t.mock.method(blobStorage, 'createUploadUrl', async (name: string) => {
    blobs.add(name);
    return `https://storage.test/${name}?sig=write`;
  });
  t.mock.method(
    blobStorage,
    'createReadUrl',
    async (name: string) => `https://storage.test/${name}?sig=read`
  );
  t.mock.method(blobStorage, 'getBlobSize', async (name: string) =>
    blobs.has(name) ? 1000 : undefined
  );
  t.mock.method(blobStorage, 'deleteBlobPermanently', async (name: string) => {
    blobs.delete(name);
    deletedBlobs.push(name);
  });
  let jobs = 0;
  t.mock.method(speech, 'startTranscription', async () => {
    jobs++;
    return `00000000-0000-0000-0000-${String(jobs).padStart(12, '0')}`;
  });
  t.mock.method(speech, 'deleteTranscription', async (id: string) => {
    deletedJobs.push(id);
  });
  return { blobs, deletedBlobs, deletedJobs };
}

async function call(
  t: TestContext,
  handler: (
    r: HttpRequest,
    c: InvocationContext
  ) => Promise<{ status?: number; jsonBody?: unknown }>,
  method: string,
  params: Record<string, string>,
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await handler(request(method, params, body), quietContext(t));
  return {
    status: response.status ?? 200,
    body: (response.jsonBody ?? {}) as Record<string, unknown>,
  };
}

async function create(t: TestContext, mode: 'live' | 'datei' = 'live'): Promise<MitschriftDetail> {
  const result = await call(
    t,
    MitschriftenCollection,
    'POST',
    {},
    {
      title: 'Leitendenrunde',
      date: '2026-10-08',
      mode,
      consent: true,
    }
  );
  assert.equal(result.status, 201);
  return result.body as unknown as MitschriftDetail;
}

function sentence(clientId: string, startMs: number, speakerKey: string | null, text: string) {
  return { clientId, source: 'raum', speakerKey, startMs, endMs: startMs + 2000, text };
}

// --- Without database ---

test('batch results keep successful sentences of the first channel, in order', () => {
  const phrases = parseTranscriptionResult({
    recognizedPhrases: [
      {
        recognitionStatus: 'Success',
        channel: 0,
        speaker: 2,
        offset: 'PT4.5S',
        duration: 'PT1S',
        offsetMilliseconds: 4500,
        durationMilliseconds: 1000,
        nBest: [{ display: 'Wir fahren ins Pfingstlager.' }],
      },
      {
        recognitionStatus: 'Success',
        channel: 0,
        speaker: 1,
        offset: 'PT1M0.04S',
        duration: 'PT2S',
        nBest: [{ display: 'Guten Morgen.' }],
      },
      { recognitionStatus: 'NoMatch', channel: 0, offsetMilliseconds: 10, nBest: [] },
      {
        recognitionStatus: 'Success',
        channel: 1,
        offsetMilliseconds: 4500,
        durationMilliseconds: 1000,
        nBest: [{ display: 'Zweiter Kanal' }],
      },
    ],
  });
  assert.deepEqual(phrases, [
    { speaker: 2, offsetMs: 4500, durationMs: 1000, text: 'Wir fahren ins Pfingstlager.' },
    { speaker: 1, offsetMs: 60040, durationMs: 2000, text: 'Guten Morgen.' },
  ]);
  assert.throws(() => parseTranscriptionResult({}), speech.SpeechError);
});

test('notes from the model always have the fixed structure', () => {
  assert.deepEqual(
    toNotizen({
      beschluesse: ['  Wir  fahren ', '', 3],
      todos: [{ aufgabe: 'Zelte prüfen', verantwortlich: 'Anna', frist: null }, { aufgabe: '' }],
      offenePunkte: 'nicht',
      naechsterTermin: '',
      extra: 'ignoriert',
    }),
    {
      beschluesse: ['Wir fahren'],
      todos: [{ aufgabe: 'Zelte prüfen', verantwortlich: 'Anna', frist: null }],
      offenePunkte: [],
      naechsterTermin: null,
    }
  );
});

test('the transcript for the model names speakers and times', () => {
  const text = transcriptText(
    [
      {
        id: 2,
        sprecherId: 7,
        source: 'teams',
        startMs: 3_725_000,
        endMs: 3_726_000,
        text: 'Später.',
        etag: '',
      },
      {
        id: 1,
        sprecherId: 5,
        source: 'raum',
        startMs: 61_000,
        endMs: 62_000,
        text: 'Hallo.',
        etag: '',
      },
      {
        id: 3,
        sprecherId: null,
        source: 'raum',
        startMs: 61_000,
        endMs: 62_000,
        text: 'Hm.',
        etag: '',
      },
    ],
    [
      { id: 5, source: 'raum', key: 'l1:Guest-1', number: 1, name: 'Anna', etag: '' },
      { id: 7, source: 'teams', key: 'l1:Guest-2', number: 2, name: '', etag: '' },
    ]
  );
  assert.equal(
    text,
    '[01:01] Anna: Hallo.\n[01:01] Unbekannt: Hm.\n[1:02:05] Teams – Sprecher 2: Später.'
  );
});

test('live sentences, jobs and hand-edited notes are validated', () => {
  assert.deepEqual(
    validateLiveAbschnitte({ abschnitte: [sentence('abcdefgh', 0, 'l1:Guest-1', ' Hallo  ')] }),
    [
      {
        clientId: 'abcdefgh',
        source: 'raum',
        speakerKey: 'l1:Guest-1',
        startMs: 0,
        endMs: 2000,
        text: 'Hallo',
      },
    ]
  );
  assert.throws(
    () =>
      validateLiveAbschnitte({
        abschnitte: [{ ...sentence('abcdefgh', 0, null, 'x'), endMs: -1 }],
      }),
    ValidationError
  );
  assert.throws(
    () => validateLiveAbschnitte({ abschnitte: [sentence('kurz', 0, null, 'x')] }),
    ValidationError
  );
  assert.deepEqual(validateAuftrag({ source: 'datei', size: 10, offsetMs: 500 }), {
    source: 'datei',
    offsetMs: 0,
    untilMs: null,
  });
  assert.deepEqual(validateAuftrag({ source: 'teams', size: 10, offsetMs: 500, untilMs: 9000 }), {
    source: 'teams',
    offsetMs: 500,
    untilMs: 9000,
  });
  assert.throws(
    () => validateAuftrag({ source: 'raum', size: 10, offsetMs: 500 }),
    ValidationError
  );
  assert.throws(() => validateAuftrag({ source: 'datei', size: 2_000_000_000 }), ValidationError);
  assert.deepEqual(
    validateNotizen({
      etag: '"x"',
      notes: {
        beschluesse: [' A ', ''],
        todos: [{ aufgabe: 'B', verantwortlich: '', frist: null }],
        offenePunkte: [],
        naechsterTermin: '',
      },
    }).notes,
    {
      beschluesse: ['A'],
      todos: [{ aufgabe: 'B', verantwortlich: null, frist: null }],
      offenePunkte: [],
      naechsterTermin: null,
    }
  );
  assert.throws(
    () =>
      validateNotizen({
        etag: '"x"',
        notes: { beschluesse: ['x'.repeat(501)], todos: [], offenePunkte: [] },
      }),
    ValidationError
  );
});

test('a new Mitschrift needs the consent of everyone present', async (t) => {
  const result = await call(
    t,
    MitschriftenCollection,
    'POST',
    {},
    {
      title: 'Leitendenrunde',
      date: '2026-10-08',
      mode: 'live',
    }
  );
  assert.equal(result.status, 400);
  assert.ok((result.body.fields as Record<string, string>).consent);
});

// --- With database ---

dbTest('live sentences are stored once, with speakers numbered per source', async (t) => {
  const meeting = await create(t);
  const params = { id: String(meeting.id) };
  const first = await call(t, MitschriftLive, 'POST', params, {
    abschnitte: [
      sentence('client-0001', 1000, 'l1:Guest-1', 'Hallo zusammen.'),
      sentence('client-0002', 4000, 'l1:Guest-2', 'Servus.'),
      { ...sentence('client-0003', 3000, 'l1:Guest-1', 'Aus Teams.'), source: 'teams' },
      // The same sentence twice in one request is stored once
      sentence('client-0001', 1000, 'l1:Guest-1', 'Hallo zusammen.'),
    ],
  });
  assert.equal(first.status, 200);
  // Sent again after a lost answer, plus one new sentence
  const second = await call(t, MitschriftLive, 'POST', params, {
    abschnitte: [
      sentence('client-0002', 4000, 'l1:Guest-2', 'Servus.'),
      sentence('client-0004', 7000, 'l2:Guest-1', 'Nach der Pause.'),
    ],
  });
  assert.deepEqual(second.body.saved, ['client-0002', 'client-0004']);

  const detail = (await getMitschrift(meeting.id))!;
  assert.deepEqual(
    detail.abschnitte.map((a) => a.text),
    ['Hallo zusammen.', 'Aus Teams.', 'Servus.', 'Nach der Pause.']
  );
  assert.deepEqual(
    detail.sprecher.map((s) => `${s.source} ${s.number}`),
    ['raum 1', 'raum 2', 'raum 3', 'teams 1']
  );

  // After the end of the recording nothing more is accepted
  assert.equal((await call(t, MitschriftFinish, 'POST', params)).status, 200);
  const late = await call(t, MitschriftLive, 'POST', params, {
    abschnitte: [sentence('client-0005', 9000, null, 'Zu spät.')],
  });
  assert.equal(late.status, 400);
});

dbTest(
  'editing the transcript is checked against its version and marks the notes outdated',
  async (t) => {
    const meeting = await create(t);
    const params = { id: String(meeting.id) };
    await call(t, MitschriftLive, 'POST', params, {
      abschnitte: [
        sentence('client-0001', 0, 'l1:Guest-1', 'Text eins.'),
        sentence('client-0002', 3000, 'l1:Guest-2', 'Text zwei.'),
      ],
    });
    await call(t, MitschriftFinish, 'POST', params);
    const notes: MitschriftNotizen = {
      beschluesse: ['Wir fahren.'],
      todos: [],
      offenePunkte: [],
      naechsterTermin: null,
    };
    t.mock.method(notizen, 'generateNotizen', async () => notes);
    const loaded = (await getMitschrift(meeting.id))!;
    const generated = await call(t, NotizenEndpoint, 'POST', params, {
      etag: loaded.etag,
      pass: 'abschluss',
    });
    assert.equal(generated.status, 200);
    assert.deepEqual(generated.body.notes, notes);

    let detail = (await getMitschrift(meeting.id))!;
    assert.equal(detail.notesStale, false);
    const [one, two] = detail.abschnitte;
    const [anna, other] = detail.sprecher;

    const edit = await call(
      t,
      MitschriftAbschnitt,
      'PATCH',
      { ...params, abschnittId: String(one.id) },
      {
        text: 'Text eins, korrigiert.',
        sprecherId: other.id,
        etag: one.etag,
      }
    );
    assert.equal(edit.status, 200);
    const stale = await call(
      t,
      MitschriftAbschnitt,
      'PATCH',
      { ...params, abschnittId: String(one.id) },
      {
        text: 'Überschreibt nichts.',
        sprecherId: null,
        etag: one.etag,
      }
    );
    assert.equal(stale.status, 409);

    const renamed = await call(
      t,
      MitschriftSprecher,
      'PATCH',
      { ...params, sprecherId: String(anna.id) },
      {
        name: 'Anna',
        etag: anna.etag,
      }
    );
    assert.equal(renamed.status, 200);
    const merged = await call(
      t,
      MitschriftSprecherMerge,
      'POST',
      { ...params, sprecherId: String(other.id) },
      {
        into: anna.id,
      }
    );
    assert.equal(merged.status, 204);

    detail = (await getMitschrift(meeting.id))!;
    assert.equal(detail.notesStale, true);
    assert.deepEqual(
      detail.sprecher.map((s) => s.name),
      ['Anna']
    );
    assert.deepEqual(
      detail.abschnitte.map((a) => [a.text, a.sprecherId]),
      [
        ['Text eins, korrigiert.', anna.id],
        ['Text zwei.', anna.id],
      ]
    );
    assert.equal(two.text, 'Text zwei.');
  }
);

dbTest('notes changed by hand are only replaced after confirming', async (t) => {
  const meeting = await create(t);
  const params = { id: String(meeting.id) };
  await call(t, MitschriftLive, 'POST', params, {
    abschnitte: [sentence('client-0001', 0, null, 'Text.')],
  });

  const live = (await getMitschrift(meeting.id))!;
  const handEdit = {
    beschluesse: ['Von Hand'],
    todos: [],
    offenePunkte: [],
    naechsterTermin: null,
  };
  // Running notes are never stored while the recording runs
  assert.equal(
    (await call(t, NotizenEndpoint, 'POST', params, { etag: live.etag, pass: 'abschluss' })).status,
    400
  );
  // Not while the recording runs
  assert.equal(
    (await call(t, NotizenEndpoint, 'PUT', params, { etag: live.etag, notes: handEdit })).status,
    400
  );
  await call(t, MitschriftFinish, 'POST', params);

  let detail = (await getMitschrift(meeting.id))!;
  assert.equal(
    (await call(t, NotizenEndpoint, 'PUT', params, { etag: detail.etag, notes: handEdit })).status,
    200
  );
  detail = (await getMitschrift(meeting.id))!;
  assert.equal(detail.notesEdited, true);

  const generate = t.mock.method(notizen, 'generateNotizen', async () => ({
    beschluesse: ['Von der KI'],
    todos: [],
    offenePunkte: [],
    naechsterTermin: null,
  }));
  const refused = await call(t, NotizenEndpoint, 'POST', params, { etag: detail.etag });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'NOTES_EDITED');
  assert.equal(generate.mock.callCount(), 0);

  // Running notes are only returned
  const running = await call(t, NotizenEndpoint, 'POST', params, { pass: 'laufend', save: false });
  assert.deepEqual((running.body.notes as MitschriftNotizen).beschluesse, ['Von der KI']);
  assert.deepEqual((await getMitschrift(meeting.id))!.notes?.beschluesse, ['Von Hand']);

  const replaced = await call(t, NotizenEndpoint, 'POST', params, {
    etag: detail.etag,
    overwrite: true,
  });
  assert.equal(replaced.status, 200);
  detail = (await getMitschrift(meeting.id))!;
  assert.deepEqual(detail.notes?.beschluesse, ['Von der KI']);
  assert.equal(detail.notesEdited, false);
});

dbTest('deleted sentences are gone for good and take the notes with them', async (t) => {
  const meeting = await create(t);
  const params = { id: String(meeting.id) };
  await call(t, MitschriftLive, 'POST', params, {
    abschnitte: [
      sentence('client-0001', 0, null, 'Vertraulich.'),
      sentence('client-0002', 3000, null, 'Öffentlich.'),
    ],
  });
  await call(t, MitschriftFinish, 'POST', params);
  t.mock.method(notizen, 'generateNotizen', async () => ({
    beschluesse: ['Vertraulich'],
    todos: [],
    offenePunkte: [],
    naechsterTermin: null,
  }));
  let detail = (await getMitschrift(meeting.id))!;
  await call(t, NotizenEndpoint, 'POST', params, { etag: detail.etag });
  detail = (await getMitschrift(meeting.id))!;

  const result = await call(t, MitschriftAbschnitteDelete, 'POST', params, {
    ids: [detail.abschnitte[0].id],
  });
  assert.deepEqual(result.body, { deleted: 1 });
  detail = (await getMitschrift(meeting.id))!;
  assert.deepEqual(
    detail.abschnitte.map((a) => a.text),
    ['Öffentlich.']
  );
  assert.equal(detail.notes, null);
  const rows = await getDb().selectFrom('mitschrift.abschnitt').select('text').execute();
  assert.deepEqual(
    rows.map((r) => r.text),
    ['Öffentlich.']
  );
});

dbTest('an uploaded file is transcribed, stored and its audio deleted right away', async (t) => {
  const azure = mockAzure(t);
  const meeting = await create(t, 'datei');
  const params = { id: String(meeting.id) };

  const ticket = await call(t, MitschriftAuftraege, 'POST', params, {
    source: 'datei',
    size: 1000,
  });
  assert.equal(ticket.status, 201);
  assert.match(String(ticket.body.uploadUrl), /sig=write/);
  assert.deepEqual(ticket.body.headers, { 'x-ms-blob-type': 'BlockBlob' });
  const auftragId = String((ticket.body.auftrag as { id: number }).id);

  assert.equal((await call(t, MitschriftAuftrag, 'POST', { ...params, auftragId })).status, 200);
  let detail = (await getMitschrift(meeting.id))!;
  assert.equal(detail.auftraege[0].status, 'laeuft');

  t.mock.method(speech, 'getTranscription', async () => ({ status: 'running' }));
  assert.equal((await call(t, MitschriftCheck, 'POST', params)).body.stored, false);

  t.mock.method(speech, 'getTranscription', async () => ({
    status: 'succeeded',
    phrases: [
      { speaker: 1, offsetMs: 0, durationMs: 1500, text: 'Willkommen.' },
      { speaker: 2, offsetMs: 2000, durationMs: 1000, text: 'Danke.' },
      { speaker: 1, offsetMs: 4000, durationMs: 1000, text: 'Los geht es.' },
    ],
  }));
  const checked = await call(t, MitschriftCheck, 'POST', params);
  assert.equal(checked.body.stored, true);
  detail = (await getMitschrift(meeting.id))!;
  assert.equal(detail.status, 'fertig');
  assert.deepEqual(detail.auftraege, []);
  assert.deepEqual(
    detail.abschnitte.map((a) => a.text),
    ['Willkommen.', 'Danke.', 'Los geht es.']
  );
  assert.equal(detail.sprecher.length, 2);
  assert.equal(azure.blobs.size, 0);
  assert.equal(azure.deletedJobs.length, 1);
});

dbTest('a gap of the live recording replaces what was recognized there', async (t) => {
  mockAzure(t);
  const meeting = await create(t);
  const params = { id: String(meeting.id) };
  await call(t, MitschriftLive, 'POST', params, {
    abschnitte: [
      sentence('client-0001', 1000, 'l1:Guest-1', 'Vorher.'),
      sentence('client-0002', 10_000, 'l1:Guest-1', 'Halber Satz in der Lü'),
      { ...sentence('client-0003', 12_000, 'l1:Guest-1', 'Teams bleibt.'), source: 'teams' },
      sentence('client-0004', 30_000, 'l2:Guest-1', 'Nachher.'),
    ],
  });
  const ticket = await call(t, MitschriftAuftraege, 'POST', params, {
    source: 'raum',
    size: 1000,
    offsetMs: 9000,
    untilMs: 29_000,
  });
  const auftragId = String((ticket.body.auftrag as { id: number }).id);
  await call(t, MitschriftAuftrag, 'POST', { ...params, auftragId });
  t.mock.method(speech, 'getTranscription', async () => ({
    status: 'succeeded',
    phrases: [{ speaker: 1, offsetMs: 1000, durationMs: 3000, text: 'Ganzer Satz in der Lücke.' }],
  }));
  await call(t, MitschriftCheck, 'POST', params);
  const detail = (await getMitschrift(meeting.id))!;
  assert.deepEqual(
    detail.abschnitte.map((a) => [a.startMs, a.source, a.text]),
    [
      [1000, 'raum', 'Vorher.'],
      [10_000, 'raum', 'Ganzer Satz in der Lücke.'],
      [12_000, 'teams', 'Teams bleibt.'],
      [30_000, 'raum', 'Nachher.'],
    ]
  );
  assert.equal(detail.status, 'live');
});

dbTest('a failed job keeps its message, but not its audio', async (t) => {
  const azure = mockAzure(t);
  const meeting = await create(t, 'datei');
  const params = { id: String(meeting.id) };
  const ticket = await call(t, MitschriftAuftraege, 'POST', params, {
    source: 'datei',
    size: 1000,
  });
  const auftragId = String((ticket.body.auftrag as { id: number }).id);
  await call(t, MitschriftAuftrag, 'POST', { ...params, auftragId });
  t.mock.method(speech, 'getTranscription', async () => ({ status: 'failed', error: 'Kaputt.' }));
  await call(t, MitschriftCheck, 'POST', params);

  let detail = (await getMitschrift(meeting.id))!;
  assert.equal(detail.auftraege[0].status, 'fehler');
  assert.equal(detail.auftraege[0].error, 'Kaputt.');
  assert.equal(azure.blobs.size, 0);

  assert.equal((await call(t, MitschriftAuftrag, 'DELETE', { ...params, auftragId })).status, 200);
  detail = (await getMitschrift(meeting.id))!;
  assert.deepEqual(detail.auftraege, []);
});

dbTest('a job that never finished is removed with its audio after the maximum time', async (t) => {
  const azure = mockAzure(t);
  const meeting = await create(t, 'datei');
  await call(
    t,
    MitschriftAuftraege,
    'POST',
    { id: String(meeting.id) },
    { source: 'datei', size: 1000 }
  );
  assert.equal(await cleanupStaleAuftraege(), 0);
  assert.equal(await cleanupStaleAuftraege(new Date(Date.now() + 25 * 3_600_000)), 1);
  assert.equal(azure.deletedBlobs.length, 1);
  assert.equal(await checkAuftraege(meeting.id), false);
});

dbTest('old Mitschriften are pointed out and deleted only on request', async (t) => {
  const azure = mockAzure(t);
  const old = await create(t);
  await getDb()
    .updateTable('mitschrift.mitschrift')
    .set({ meeting_date: '2020-01-01' })
    .where('id', '=', old.id)
    .execute();
  await call(
    t,
    MitschriftAuftraege,
    'POST',
    { id: String(old.id) },
    { source: 'raum', size: 10, offsetMs: 0, untilMs: 10 }
  );
  const recent = await create(t);

  const overview = await getMitschriftenOverview();
  assert.equal(overview.oldCount, 1);
  assert.ok(warnBefore() > '2020-01-01');

  const result = await call(t, MitschriftenCleanup, 'POST', {});
  assert.deepEqual(result.body, { deleted: 1 });
  assert.equal(await getMitschrift(old.id), undefined);
  assert.ok(await getMitschrift(recent.id));
  assert.equal(azure.deletedBlobs.length, 1);

  assert.equal((await call(t, MitschriftItem, 'DELETE', { id: String(recent.id) })).status, 204);
  assert.equal((await getMitschriftenOverview()).mitschriften.length, 0);
});

dbTest('title and date change against the loaded version', async (t) => {
  const meeting = await create(t);
  const params = { id: String(meeting.id) };
  const changed = await call(t, MitschriftItem, 'PATCH', params, {
    title: 'Stavo-Runde',
    date: '2026-10-09',
    etag: meeting.etag,
  });
  assert.equal(changed.status, 200);
  const conflict = await call(t, MitschriftItem, 'PATCH', params, {
    title: 'Alt',
    date: '2026-10-09',
    etag: meeting.etag,
  });
  assert.equal(conflict.status, 409);
  assert.equal((await getMitschrift(meeting.id))!.title, 'Stavo-Runde');
});

dbTest('previews get one invented Mitschrift, also when seeded twice', async () => {
  await seedPreviewMitschriften();
  await seedPreviewMitschriften();
  const overview = await getMitschriftenOverview();
  assert.equal(overview.mitschriften.length, 1);
  const detail = (await getMitschrift(overview.mitschriften[0].id))!;
  assert.equal(detail.status, 'fertig');
  assert.ok(detail.abschnitte.length > 5);
  assert.deepEqual(
    detail.sprecher.map((s) => `${s.source} ${s.number}`),
    ['raum 1', 'raum 2', 'raum 3', 'teams 1']
  );
  assert.ok(detail.notes && detail.notes.todos.length > 0);
});

dbTest(
  'sentences cut apart are joined into the first one, checked against their versions',
  async (t) => {
    const meeting = await create(t);
    const params = { id: String(meeting.id) };
    await call(t, MitschriftLive, 'POST', params, {
      abschnitte: [
        sentence('client-0001', 1000, 'l1:Guest-1', 'Also beim Pfingstlager müssen wir noch.'),
        sentence('client-0002', 4000, 'l1:Guest-1', 'Die Anzahlung überweisen.'),
        sentence('client-0003', 9000, 'l1:Guest-2', 'Nächstes Thema.'),
      ],
    });
    await call(t, MitschriftFinish, 'POST', params);
    let detail = (await getMitschrift(meeting.id))!;
    const [one, two, three] = detail.abschnitte;

    // A sentence changed in the meantime: nothing is joined
    const stale = await call(t, MitschriftAbschnitteMerge, 'POST', params, {
      abschnitte: [
        { id: one.id, etag: one.etag },
        { id: two.id, etag: '"0000000000000000"' },
      ],
      text: 'Egal.',
    });
    assert.equal(stale.status, 409);

    const merged = await call(t, MitschriftAbschnitteMerge, 'POST', params, {
      abschnitte: [
        { id: two.id, etag: two.etag },
        { id: one.id, etag: one.etag },
      ],
      text: 'Also beim Pfingstlager müssen wir noch die Anzahlung überweisen.',
    });
    assert.equal(merged.status, 200);
    assert.equal(merged.body.id, one.id);

    detail = (await getMitschrift(meeting.id))!;
    assert.deepEqual(
      detail.abschnitte.map((a) => [a.id, a.startMs, a.endMs, a.text]),
      [
        [one.id, 1000, 6000, 'Also beim Pfingstlager müssen wir noch die Anzahlung überweisen.'],
        [three.id, 9000, 11000, 'Nächstes Thema.'],
      ]
    );
    assert.equal(
      (
        await call(t, MitschriftAbschnitteMerge, 'POST', params, {
          abschnitte: [{ id: three.id, etag: three.etag }],
          text: 'Nur einer.',
        })
      ).status,
      400
    );
  }
);

dbTest('sentences of the room and of Teams are not joined', async (t) => {
  const meeting = await create(t);
  const params = { id: String(meeting.id) };
  await call(t, MitschriftLive, 'POST', params, {
    abschnitte: [
      sentence('client-0001', 0, 'l1:Guest-1', 'Im Raum.'),
      { ...sentence('client-0002', 3000, 'l1:Guest-1', 'Aus Teams.'), source: 'teams' },
    ],
  });
  const [room, teams] = (await getMitschrift(meeting.id))!.abschnitte;
  const result = await call(t, MitschriftAbschnitteMerge, 'POST', params, {
    abschnitte: [
      { id: room.id, etag: room.etag },
      { id: teams.id, etag: teams.etag },
    ],
    text: 'Im Raum aus Teams.',
  });
  assert.equal(result.status, 400);
  assert.equal((await getMitschrift(meeting.id))!.abschnitte.length, 2);
});
