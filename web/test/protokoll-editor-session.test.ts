import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { SPERRE_RENEW_SECONDS } from '../src/lib/protokollEditor';
import { POLL_MS, RETRY_MS, SAVE_DELAY_MS } from '../src/lib/protokollSpeichern';
import { settle } from './fixtures/fake-clock';
import { gate, json } from './fixtures/fetch-stub';
import {
  ID,
  LOGIN,
  detail,
  failure,
  harness,
  opened,
  sperre,
  type Harness,
} from './fixtures/protokoll-session';

/** Saving, the copy on this device and the lock of the Protokoll editor, against a stubbed API. */

let h: Harness | null = null;
afterEach(() => {
  h?.close();
  h = null;
});

function start(): Harness {
  h = harness();
  return h;
}

const draftKey = `phoenix:protokoll-entwurf:v1:${ID}`;

test('a change is kept on this device and saved after the quiet time', async () => {
  const t = start();
  await opened(t);
  assert.equal(t.session.mode, 'schreiben');
  t.edit((stand) => (stand.title = 'Leiterrunde November'));
  assert.equal(t.session.speicherung.saveState, 'ungespeichert');
  const kept = JSON.parse(localStorage.getItem(draftKey) ?? 'null') as Record<string, unknown>;
  assert.equal(kept.title, 'Leiterrunde November');
  assert.equal(kept.baseEtag, 'v1');
  assert.equal(kept.login, LOGIN);

  await t.clock.advance(SAVE_DELAY_MS - 1);
  assert.equal(t.saves().length, 0);
  await t.clock.advance(1);
  const [body] = t.saves();
  assert.equal(body.title, 'Leiterrunde November');
  assert.equal(body.etag, 'v1');
  assert.equal(body.token, t.session.token);
  assert.equal(body.sicherung, null);
  assert.equal(t.session.speicherung.saveState, 'gespeichert');
  assert.equal(t.session.speicherung.etag, 'v2');
  assert.equal(localStorage.getItem(draftKey), null);
});

test('the copy on this device is the same text as the stand with its version', async () => {
  const t = start();
  await opened(t);
  t.edit((stand) => (stand.inhalt.kopf.beginn = '19:30'));
  const snapshot = t.session.snapshot();
  const kept = localStorage.getItem(draftKey);
  assert.equal(
    kept,
    JSON.stringify({
      ...snapshot,
      baseEtag: 'v1',
      changedAt: new Date(t.clock.now()).toISOString(),
      login: LOGIN,
    })
  );
});

test('undoing a change before the save needs no save', async () => {
  const t = start();
  await opened(t);
  t.edit((stand) => (stand.title = 'Anders'));
  t.edit((stand) => (stand.title = 'Leiterrunde'));
  assert.equal(t.session.speicherung.saveState, 'gespeichert');
  assert.equal(localStorage.getItem(draftKey), null);
  await t.clock.advance(SAVE_DELAY_MS * 2);
  assert.equal(t.saves().length, 0);
});

test('a change typed during the save is saved right after, on the new version', async () => {
  const t = start();
  const first = gate<Response>();
  const accept = t.server.save;
  t.server.save = (call) => {
    t.server.save = accept;
    accept(call);
    return first.promise;
  };
  await opened(t);
  t.edit((stand) => (stand.title = 'Erste'));
  await t.clock.advance(SAVE_DELAY_MS);
  assert.equal(t.session.speicherung.saveState, 'speichert');
  t.edit((stand) => (stand.title = 'Zweite'));
  first.open(json({ etag: 'v2', updatedAt: '2026-11-13T09:00:00Z', sperre: sperre(true) }));
  await settle();
  assert.equal(t.session.speicherung.saveState, 'ungespeichert');
  // The copy on this device is now based on the saved version
  const kept = JSON.parse(localStorage.getItem(draftKey) ?? 'null') as Record<string, unknown>;
  assert.equal(kept.baseEtag, 'v2');
  await t.clock.advance(SAVE_DELAY_MS);
  const saves = t.saves();
  assert.equal(saves.length, 2);
  assert.equal(saves[1].title, 'Zweite');
  assert.equal(saves[1].etag, 'v2');
  assert.equal(t.session.speicherung.saveState, 'gespeichert');
});

test('ending the writing waits for the save on its way, then frees the lock', async () => {
  const t = start();
  const held = gate<Response>();
  t.server.save = () => held.promise;
  await opened(t);
  t.edit((stand) => (stand.title = 'Ende'));
  await t.clock.advance(SAVE_DELAY_MS);
  let stopped: boolean | null = null;
  const stopping = t.session.stopWriting().then((value) => (stopped = value));
  await settle();
  assert.equal(stopped, null);
  assert.equal(t.session.mode, 'schreiben');
  held.open(json({ etag: 'v2', updatedAt: '2026-11-13T09:00:00Z', sperre: sperre(true) }));
  await stopping;
  assert.equal(stopped, true);
  assert.equal(t.session.mode, 'lesen');
  assert.ok(t.calls.some((call) => call.method === 'DELETE' && call.path.endsWith('/sperre')));
});

test('ending the writing with unsaved changes keeps writing and says so', async () => {
  const t = start();
  t.server.save = () => Promise.reject(new TypeError('Failed to fetch'));
  await opened(t);
  t.edit((stand) => (stand.title = 'Offline'));
  assert.equal(await t.session.stopWriting(), false);
  assert.equal(t.session.mode, 'schreiben');
  assert.deepEqual(t.notices.at(-1), {
    text: 'Noch nicht alles ist gespeichert. Die Änderungen bleiben auf diesem Gerät gesichert.',
    kind: 'warning',
  });
});

test('offline the save is tried again with growing waits', async () => {
  const t = start();
  const accept = t.server.save;
  let failures = 2;
  t.server.save = (call) =>
    failures-- > 0 ? Promise.reject(new TypeError('Failed to fetch')) : accept(call);
  await opened(t);
  t.edit((stand) => (stand.title = 'Unterwegs'));
  await t.clock.advance(SAVE_DELAY_MS);
  assert.equal(t.session.speicherung.saveState, 'offline');
  assert.equal(
    t.session.speicherung.statusText,
    'Offline – Änderungen sind auf diesem Gerät gesichert'
  );
  await t.clock.advance(RETRY_MS[0]);
  assert.equal(t.saves().length, 2);
  await t.clock.advance(RETRY_MS[1] - 1);
  assert.equal(t.saves().length, 2);
  await t.clock.advance(1);
  assert.equal(t.saves().length, 3);
  assert.equal(t.session.speicherung.saveState, 'gespeichert');
});

test('without title nothing is sent and the status says what is missing', async () => {
  const t = start();
  await opened(t);
  t.edit((stand) => (stand.title = '  '));
  await t.clock.advance(SAVE_DELAY_MS);
  assert.equal(t.saves().length, 0);
  assert.equal(t.session.speicherung.saveState, 'fehler');
  assert.equal(
    t.session.speicherung.statusText,
    'Bitte Titel und Datum angeben, dann wird wieder gespeichert.'
  );
});

test('a lock taken by another tab ends the writing and parks the copy on this device', async () => {
  const t = start();
  t.server.save = () => failure(423, 'Gesperrt');
  await opened(t);
  t.server.stored = detail('v1', { sperre: sperre(false) });
  t.edit((stand) => (stand.title = 'Meine Fassung'));
  await t.clock.advance(SAVE_DELAY_MS);
  assert.equal(t.session.mode, 'lesen');
  assert.equal(t.session.stand, null);
  assert.deepEqual(t.notices.at(-1), {
    text: 'Anna hat die Bearbeitung übernommen. Deine letzten Änderungen sind auf diesem Gerät gesichert.',
    kind: 'warning',
  });
  assert.equal(t.session.localConflict?.title, 'Meine Fassung');
  assert.equal(localStorage.getItem(draftKey), null);
});

test('minutes given to the review meanwhile end the writing with the reason', async () => {
  const t = start();
  t.server.save = () => failure(409, 'Das Protokoll liegt zur Prüfung.', 'NOT_EDITABLE');
  await opened(t);
  t.edit((stand) => (stand.title = 'Zu spät'));
  await t.clock.advance(SAVE_DELAY_MS);
  assert.equal(t.session.mode, 'lesen');
  assert.deepEqual(t.notices.at(-1), { text: 'Das Protokoll liegt zur Prüfung.', kind: 'warning' });
});

test('deleted minutes stop the saving with a message and no retry', async () => {
  const t = start();
  t.server.save = () => failure(404, 'Nicht gefunden');
  await opened(t);
  t.edit((stand) => (stand.title = 'Weg'));
  await t.clock.advance(SAVE_DELAY_MS);
  assert.equal(t.session.speicherung.saveState, 'fehler');
  assert.equal(
    t.session.speicherung.saveError,
    'Das Protokoll wurde gelöscht. Deine Änderungen sind auf diesem Gerät gesichert.'
  );
  await t.clock.advance(RETRY_MS.at(-1) ?? 0);
  assert.equal(t.saves().length, 1);
});

test('the lock is renewed while writing, and a refused renewal ends the writing', async () => {
  const t = start();
  await opened(t);
  const locks = (): number => t.calls.filter((call) => call.path.endsWith('/sperre')).length;
  const before = locks();
  await t.clock.advance(SPERRE_RENEW_SECONDS * 1000);
  assert.equal(locks(), before + 1);
  t.server.lock = () => failure(423, 'Gesperrt');
  t.server.stored = detail('v1', { sperre: sperre(false) });
  await t.clock.advance(SPERRE_RENEW_SECONDS * 1000);
  assert.equal(t.session.mode, 'lesen');
  assert.deepEqual(t.notices.at(-1), {
    text: 'Anna hat die Bearbeitung übernommen.',
    kind: 'warning',
  });
});

test('taking the lock while another tab writes asks before taking it over', async () => {
  const t = start();
  t.server.stored = detail('v1', { sperre: sperre(false) });
  t.server.lock = () => failure(423, 'Gesperrt');
  await opened(t, false);
  await t.session.startWriting();
  assert.equal(t.session.mode, 'lesen');
  assert.equal(t.session.takeover?.name, 'Anna');
});

test('unsaved changes on this device continue when the stored version is unchanged', async () => {
  const t = start();
  const stored = detail('v1');
  localStorage.setItem(
    draftKey,
    JSON.stringify({
      title: 'Vom Gerät',
      date: stored.date,
      inhalt: stored.inhalt,
      baseEtag: 'v1',
      changedAt: '2026-11-13T08:45:00Z',
      login: LOGIN,
    })
  );
  await opened(t, false);
  assert.equal(t.session.mode, 'schreiben');
  assert.equal(t.session.stand?.title, 'Vom Gerät');
  assert.match(
    t.notices.at(-1)?.text ?? '',
    /^Nicht gespeicherte Änderungen von .* wiederhergestellt\.$/
  );
});

test('a reader marks the changed items, follows the writer and stops when scrolling', async () => {
  const t = start();
  t.server.stored = detail('v1', { sperre: sperre(false) });
  await opened(t, false);
  assert.equal(t.session.mode, 'lesen');
  const changed = detail('v2', { sperre: sperre(false, 'p0') });
  changed.inhalt.punkte[0].text = '<p>Neu</p>';
  t.server.live = () => json({ etag: 'v2', sperre: changed.sperre, protokoll: changed });
  await t.clock.advance(POLL_MS);
  assert.deepEqual([...t.session.mitlesen.changed], ['p0']);
  assert.deepEqual(t.followed, ['p0']);
  assert.equal(t.session.detail?.etag, 'v2');
  await t.clock.advance(2000);
  assert.equal(t.session.mitlesen.changed.size, 0);
  t.session.mitlesen.stopFollowing();
  assert.equal(t.session.mitlesen.follow, false);
});
