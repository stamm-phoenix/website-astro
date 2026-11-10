import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  ANMELDUNG_KONFLIKT_MELDUNG,
  KONFLIKT_MELDUNG,
  legacyZugriff,
  leereEingaben,
  loadEingaben,
  markiereEingaben,
  neueAblage,
  refreshEingaben,
  readLegacyStorage,
  rescueEingaben,
  speichereEingaben,
  stelleEingabenWiederHer,
} from '../src/lib/abrechnungEingaben';
import type { EingabenIo, EingabenRegistry, StoredSession } from '../src/lib/abrechnungEingaben';
import { ABRECHNUNG_STORAGE_PREFIX } from '../src/lib/abrechnungAblage';
import { ApiError } from '../src/lib/apiError';
import { emptySession } from '../../api/lib/abrechnung-session';
import type { AbrechnungEingabe, AbrechnungSession } from '../../api/lib/abrechnung-session';

const EVENT = 'evt_Sola26';
const USER = 'user-1';

function stand(etag: string | null, patch: Partial<AbrechnungSession> = {}): AbrechnungEingabe {
  return {
    session: { ...emptySession(), ...patch },
    etag,
    savedAt: etag === null ? null : '2026-10-01T12:00:00Z',
    deleteAfter: etag === null ? null : '2026-12-11',
  };
}

function registry(): EingabenRegistry {
  return {
    sessions: {},
    ablage: {},
    storedJson: {},
    openDrafts: {},
    zeitplanZeilen: {},
    zeitplanFreitext: {},
  };
}

/** Opens the Aktion the way the store does: an empty session, then the load. */
function oeffne(reg: EingabenRegistry): void {
  reg.sessions[EVENT] = emptySession();
  reg.ablage[EVENT] = neueAblage();
}

interface Fake {
  io: EingabenIo;
  puts: { session: AbrechnungSession; etag: string | null }[];
  removed: number;
  server: AbrechnungEingabe;
  legacy: StoredSession | null;
}

/** A server that keeps what was saved; `hold` lets a test answer a request later. */
function fake(server: AbrechnungEingabe): Fake {
  const state: Fake = {
    puts: [],
    removed: 0,
    server,
    legacy: null,
    io: {
      fetch: async () => structuredClone(state.server),
      put: async (_id, body) => {
        state.puts.push(body);
        state.server = { ...stand('v' + (state.puts.length + 1)), session: body.session };
        return structuredClone(state.server);
      },
      readLegacy: () => state.legacy,
      removeLegacy: () => {
        state.removed++;
      },
    },
  };
  return state;
}

function laden(reg: EingabenRegistry, f: Fake): Promise<void> {
  return loadEingaben(reg, f.io, EVENT);
}

function defer<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  Object.assign(globalThis, {
    location: { pathname: '/leitendenbereich/abrechnung/evt_Sola26', search: '' },
    sessionStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    },
    window: { dispatchEvent: () => true },
  });
});

test('old entries of this device are offered as unsaved and removed only after a saved migration', async () => {
  const reg = registry();
  oeffne(reg);
  const f = fake(stand(null));
  f.legacy = {
    session: { ...emptySession(), zusatztag: true },
    savedAt: '2026-09-30T10:00:00Z',
    deleteAfter: '2026-12-11',
  };
  await laden(reg, f);
  assert.equal(reg.sessions[EVENT].zusatztag, true);
  assert.equal(reg.ablage[EVENT].dirty, true);
  assert.equal(f.removed, 0);

  // A refused save keeps the copy on the device
  f.io.put = async () => {
    throw new ApiError(500, 'kaputt', { unexplained: true });
  };
  assert.equal(await speichereEingaben(reg, f.io, EVENT), false);
  assert.equal(f.removed, 0);

  const gut = fake(f.server);
  assert.equal(await speichereEingaben(reg, gut.io, EVENT), true);
  assert.equal(gut.removed, 1);
  assert.equal(reg.ablage[EVENT].dirty, false);
});

test('a saved version of the account wins over an older copy of the device', async () => {
  const reg = registry();
  oeffne(reg);
  const f = fake(stand('v1', { zusatztag: false }));
  f.legacy = { session: { ...emptySession(), zusatztag: true }, savedAt: '', deleteAfter: '' };
  await laden(reg, f);
  assert.equal(reg.sessions[EVENT].zusatztag, false);
  assert.equal(reg.ablage[EVENT].dirty, false);
});

test('the copy of the device is read only when it is valid, current and not empty', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => void store.delete(key),
  };
  const key = 'phoenix:abrechnung:v1:evt';
  const geschrieben = (value: unknown): void => void store.set(key, JSON.stringify(value));
  assert.deepEqual(readLegacyStorage(storage, key, '2026-10-01'), {
    available: true,
    stored: null,
  });
  geschrieben({
    session: { zusatztag: true },
    savedAt: '2026-09-30T10:00:00Z',
    deleteAfter: '2026-12-11',
  });
  const gelesen = readLegacyStorage(storage, key, '2026-10-01').stored;
  assert.equal(gelesen?.session.zusatztag, true);
  // Nothing entered: nothing to offer
  geschrieben({ session: {}, savedAt: '2026-09-30T10:00:00Z', deleteAfter: '2026-12-11' });
  assert.equal(readLegacyStorage(storage, key, '2026-10-01').stored, null);
  // Past its deletion date: removed from the device
  geschrieben({
    session: { zusatztag: true },
    savedAt: '2026-09-30T10:00:00Z',
    deleteAfter: '2026-09-30',
  });
  assert.equal(readLegacyStorage(storage, key, '2026-10-01').stored, null);
  assert.equal(store.has(key), false);
  // Not JSON, or without a valid date
  store.set(key, 'kein json');
  assert.equal(readLegacyStorage(storage, key, '2026-10-01').stored, null);
  geschrieben({ session: { zusatztag: true }, savedAt: 'gestern', deleteAfter: '2026-12-11' });
  assert.equal(readLegacyStorage(storage, key, '2026-10-01').stored, null);
  // Storage that refuses to answer
  const kaputt = {
    getItem: () => {
      throw new Error('gesperrt');
    },
    removeItem: () => undefined,
  };
  assert.deepEqual(readLegacyStorage(kaputt, key, '2026-10-01'), {
    available: false,
    stored: null,
  });
});

test('a failed reset keeps what was typed while its request ran', async () => {
  const reg = registry();
  oeffne(reg);
  const f = fake(stand('v1', { zusatztag: true }));
  await laden(reg, f);
  assert.equal(reg.sessions[EVENT].zusatztag, true);

  const gestartet = defer();
  const antwort = defer<AbrechnungEingabe>();
  f.io.put = async () => {
    gestartet.resolve();
    return antwort.promise;
  };
  const reset = leereEingaben(reg, f.io, EVENT);
  await gestartet.promise;
  assert.equal(reg.ablage[EVENT].saving, true);
  // The person unticks the box while the request is under way
  reg.sessions[EVENT].zusatztag = false;
  antwort.resolve(Promise.reject(new ApiError(500, 'kaputt', { unexplained: true })) as never);
  assert.equal(await reset, false);

  const ablage = reg.ablage[EVENT];
  assert.match(ablage.error ?? '', /Die Eingaben wurden nicht gespeichert/);
  assert.equal(ablage.conflict, false);
  assert.equal(ablage.saving, false);
  assert.equal(reg.sessions[EVENT].zusatztag, false);
  assert.equal(ablage.dirty, true);
});

test('a confirmed reset empties the entries, but not edits made during the request', async () => {
  const reg = registry();
  oeffne(reg);
  const f = fake(stand('v1', { zusatztag: true }));
  await laden(reg, f);
  assert.equal(await leereEingaben(reg, f.io, EVENT), true);
  assert.equal(reg.sessions[EVENT].zusatztag, false);
  assert.equal(reg.ablage[EVENT].dirty, false);
  assert.deepEqual(f.puts[0].session, emptySession());

  const gestartet = defer();
  const antwort = defer<AbrechnungEingabe>();
  const echt = f.io.put;
  f.io.put = async (id, body) => {
    gestartet.resolve();
    await antwort.promise;
    return echt(id, body);
  };
  reg.sessions[EVENT].zusatztag = true;
  const zweiter = leereEingaben(reg, f.io, EVENT);
  await gestartet.promise;
  reg.sessions[EVENT].kjr.ort = 'Neu getippt';
  antwort.resolve(stand('v9'));
  assert.equal(await zweiter, true);
  assert.equal(reg.sessions[EVENT].kjr.ort, 'Neu getippt');
  assert.equal(reg.ablage[EVENT].dirty, true);
});

test('a refused save keeps the inputs, names the problem and can be tried again', async () => {
  const reg = registry();
  oeffne(reg);
  const f = fake(stand('v1'));
  await laden(reg, f);
  reg.sessions[EVENT].zusatztag = true;
  const echt = f.io.put;
  f.io.put = async () => {
    throw new ApiError(500, 'kaputt', { unexplained: true });
  };
  assert.equal(await speichereEingaben(reg, f.io, EVENT), false);
  assert.match(reg.ablage[EVENT].error ?? '', /Die Eingaben wurden nicht gespeichert/);
  assert.equal(reg.sessions[EVENT].zusatztag, true);
  markiereEingaben(reg, EVENT);
  assert.equal(reg.ablage[EVENT].dirty, true);
  f.io.put = echt;
  assert.equal(await speichereEingaben(reg, f.io, EVENT), true);
  assert.equal(reg.ablage[EVENT].error, null);
  assert.equal(reg.ablage[EVENT].dirty, false);
  assert.equal(f.puts[0].etag, 'v1');
});

test('a newer version on the server is a conflict that blocks saving and refreshing', async () => {
  const reg = registry();
  oeffne(reg);
  const f = fake(stand('v1'));
  await laden(reg, f);
  reg.sessions[EVENT].zusatztag = true;
  f.io.put = async () => {
    throw new ApiError(412, 'veraltet');
  };
  assert.equal(await speichereEingaben(reg, f.io, EVENT), false);
  assert.equal(reg.ablage[EVENT].conflict, true);
  assert.equal(reg.ablage[EVENT].error, KONFLIKT_MELDUNG);
  let aufgerufen = false;
  f.io.put = async () => {
    aufgerufen = true;
    return stand('v2');
  };
  assert.equal(await speichereEingaben(reg, f.io, EVENT), false);
  assert.equal(aufgerufen, false);
  await refreshEingaben(reg, f.io, EVENT);
  assert.equal(reg.sessions[EVENT].zusatztag, true);
});

test('a load that was discarded cannot overwrite a reopened draft or its unsaved state', async () => {
  const reg = registry();
  oeffne(reg);
  const f = fake(stand('v1'));
  await laden(reg, f);

  const spaet = defer<AbrechnungEingabe>();
  const echt = f.io.fetch;
  let aufrufe = 0;
  f.io.fetch = (id) => (++aufrufe === 1 ? spaet.promise : echt(id));
  const veraltet = loadEingaben(reg, f.io, EVENT);
  // The page is left and opened again: a new session with its own state
  delete reg.sessions[EVENT];
  delete reg.ablage[EVENT];
  delete reg.storedJson[EVENT];
  oeffne(reg);
  await loadEingaben(reg, f.io, EVENT);
  const wiedergeoeffnet = reg.sessions[EVENT];
  wiedergeoeffnet.kjr.ort = 'Neue Eingabe nach dem Wiederöffnen';
  markiereEingaben(reg, EVENT);

  spaet.resolve(stand('v1'));
  await veraltet;
  markiereEingaben(reg, EVENT);
  assert.equal(wiedergeoeffnet.kjr.ort, 'Neue Eingabe nach dem Wiederöffnen');
  assert.equal(reg.ablage[EVENT].dirty, true);
});

test('a save of a discarded page does not touch a newly opened session', async () => {
  const reg = registry();
  oeffne(reg);
  const f = fake(stand('v1'));
  await laden(reg, f);
  const antwort = defer<AbrechnungEingabe>();
  f.io.put = () => antwort.promise;
  reg.sessions[EVENT].zusatztag = true;
  const speichern = speichereEingaben(reg, f.io, EVENT);
  delete reg.sessions[EVENT];
  delete reg.ablage[EVENT];
  oeffne(reg);
  const neu = reg.ablage[EVENT];
  antwort.resolve(stand('v2'));
  assert.equal(await speichern, false);
  assert.equal(neu.etag, null);
  assert.equal(f.removed, 0);
});

test('a refresh adopts a newer version only while nothing was changed and no dialog is open', async () => {
  const reg = registry();
  oeffne(reg);
  const f = fake(stand('v1'));
  await laden(reg, f);
  f.server = stand('v2', { zusatztag: true });
  await refreshEingaben(reg, f.io, EVENT);
  assert.equal(reg.sessions[EVENT].zusatztag, true);
  assert.equal(reg.ablage[EVENT].etag, 'v2');
  assert.equal(reg.ablage[EVENT].conflict, false);

  // Same version: only the dates move
  f.server = { ...stand('v2', { zusatztag: true }), savedAt: '2026-10-02T08:00:00Z' };
  await refreshEingaben(reg, f.io, EVENT);
  assert.equal(reg.ablage[EVENT].savedAt, '2026-10-02T08:00:00Z');

  // An amount being typed in a dialog counts as unsaved input
  reg.openDrafts[EVENT] = 1;
  f.server = stand('v3', { zusatztag: false });
  await refreshEingaben(reg, f.io, EVENT);
  assert.equal(reg.ablage[EVENT].conflict, true);
  assert.equal(reg.ablage[EVENT].error, KONFLIKT_MELDUNG);
  assert.equal(reg.sessions[EVENT].zusatztag, true);
});

test('a refresh is a conflict when the person changed something or typed Zeitplan lines', async () => {
  for (const eingabe of ['feld', 'zeilen', 'freitext'] as const) {
    const reg = registry();
    oeffne(reg);
    const f = fake(stand('v1'));
    await laden(reg, f);
    if (eingabe === 'feld') reg.sessions[EVENT].kjr.ort = 'Lager';
    if (eingabe === 'zeilen') reg.zeitplanZeilen[EVENT] = { '2026-08-01': 'Zelte aufbauen' };
    if (eingabe === 'freitext') reg.zeitplanFreitext[EVENT] = 'Ein Lagertag';
    f.server = stand('v2', { zusatztag: true });
    await refreshEingaben(reg, f.io, EVENT);
    assert.equal(reg.ablage[EVENT].conflict, true, eingabe);
    assert.equal(reg.sessions[EVENT].zusatztag, false, eingabe);
  }
});

test('a failed or outdated refresh changes nothing', async () => {
  const reg = registry();
  oeffne(reg);
  const f = fake(stand('v1'));
  await laden(reg, f);
  f.io.fetch = async () => {
    throw new ApiError(401, 'abgelaufen');
  };
  await refreshEingaben(reg, f.io, EVENT);
  assert.equal(reg.ablage[EVENT].conflict, false);
  assert.equal(reg.ablage[EVENT].error, null);

  // A save finishing meanwhile has a newer answer than the refresh
  const spaet = defer<AbrechnungEingabe>();
  f.io.fetch = () => spaet.promise;
  const refresh = refreshEingaben(reg, f.io, EVENT);
  reg.ablage[EVENT].etag = 'v5';
  spaet.resolve(stand('v2', { zusatztag: true }));
  await refresh;
  assert.equal(reg.sessions[EVENT].zusatztag, false);
  assert.equal(reg.ablage[EVENT].etag, 'v5');
});

test('rescued entries come back for the same account and Aktion only', async () => {
  const reg = registry();
  oeffne(reg);
  const f = fake(stand('v1'));
  await laden(reg, f);
  reg.sessions[EVENT].zusatztag = true;
  reg.sessions[EVENT].plz['gast'] = '83620';
  reg.zeitplanFreitext[EVENT] = 'Ein Lagertag';
  assert.equal(rescueEingaben(reg, EVENT, USER, 'Abrechnung'), true);

  // A different account finds nothing and leaves the kept draft alone
  const anderer = registry();
  oeffne(anderer);
  await laden(anderer, f);
  assert.equal(stelleEingabenWiederHer(anderer, EVENT, 'another-account'), false);
  assert.equal(anderer.sessions[EVENT].zusatztag, false);
  assert.equal(anderer.ablage[EVENT].conflict, false);

  // The same account gets everything back, unsaved, without a conflict
  assert.equal(stelleEingabenWiederHer(anderer, EVENT, USER), true);
  assert.equal(anderer.sessions[EVENT].zusatztag, true);
  assert.equal(anderer.sessions[EVENT].plz['gast'], '83620');
  assert.equal(anderer.zeitplanFreitext[EVENT], 'Ein Lagertag');
  assert.equal(anderer.ablage[EVENT].dirty, true);
  assert.equal(anderer.ablage[EVENT].conflict, false);
  assert.equal(memory.size, 0);
  assert.equal(stelleEingabenWiederHer(anderer, EVENT, USER), false);
});

test('rescued entries older than an hour or from another page are not restored', async () => {
  const reg = registry();
  oeffne(reg);
  await laden(reg, fake(stand('v1')));
  reg.sessions[EVENT].zusatztag = true;
  rescueEingaben(reg, EVENT, USER, 'Abrechnung');
  const spaeter = Date.now() + 61 * 60 * 1000;
  const zweite = registry();
  oeffne(zweite);
  await laden(zweite, fake(stand('v1')));
  assert.equal(stelleEingabenWiederHer(zweite, EVENT, USER, spaeter), false);
  Object.assign(globalThis, { location: { pathname: '/andere/seite', search: '' } });
  assert.equal(stelleEingabenWiederHer(zweite, EVENT, USER), false);
});

test('recovered entries never overwrite a newer saved version, also not after a second login', async () => {
  const reg = registry();
  oeffne(reg);
  const f = fake(stand('v1'));
  await laden(reg, f);
  reg.sessions[EVENT].zusatztag = true;
  assert.equal(rescueEingaben(reg, EVENT, USER, 'Abrechnung'), true);

  // Meanwhile another device saved version v2; the page loads after the login
  f.server = stand('v2', { zusatztag: false });
  const nachLogin = registry();
  oeffne(nachLogin);
  await laden(nachLogin, f);
  assert.equal(stelleEingabenWiederHer(nachLogin, EVENT, USER), true);
  const ablage = nachLogin.ablage[EVENT];
  assert.equal(nachLogin.sessions[EVENT].zusatztag, true);
  assert.equal(ablage.conflict, true);
  assert.equal(ablage.error, ANMELDUNG_KONFLIKT_MELDUNG);
  assert.equal(ablage.etag, 'v1');

  // Saving is refused, and nothing reaches the server
  f.puts.length = 0;
  assert.equal(await speichereEingaben(nachLogin, f.io, EVENT), false);
  assert.equal(f.puts.length, 0);
  assert.equal(f.server.session.zusatztag, false);

  // A second login rescues the same draft with its old base version and conflicts again
  assert.equal(rescueEingaben(nachLogin, EVENT, USER, 'Abrechnung'), true);
  const zweiterLogin = registry();
  oeffne(zweiterLogin);
  await laden(zweiterLogin, f);
  assert.equal(stelleEingabenWiederHer(zweiterLogin, EVENT, USER), true);
  assert.equal(zweiterLogin.ablage[EVENT].conflict, true);
  assert.equal(zweiterLogin.ablage[EVENT].etag, 'v1');
  assert.equal(zweiterLogin.sessions[EVENT].zusatztag, true);
  assert.equal(await speichereEingaben(zweiterLogin, f.io, EVENT), false);
});

test('rescue needs a loaded session that is not being saved', () => {
  const reg = registry();
  oeffne(reg);
  assert.equal(rescueEingaben(reg, EVENT, USER, 'Abrechnung'), false);
  assert.equal(stelleEingabenWiederHer(reg, EVENT, USER), false);
  reg.ablage[EVENT].loaded = true;
  reg.ablage[EVENT].saving = true;
  assert.equal(rescueEingaben(reg, EVENT, USER, 'Abrechnung'), false);
});

test('the copy of an older version is kept under the key of the deployed pages', async () => {
  // The store passes this prefix on; entries of the deployed pages sit under it
  assert.equal(ABRECHNUNG_STORAGE_PREFIX, 'phoenix:abrechnung:v1:');
  const store = new Map<string, string>();
  const zugriff = legacyZugriff(
    () => ({
      getItem: (key) => store.get(key) ?? null,
      removeItem: (key) => void store.delete(key),
    }),
    'phoenix:abrechnung:v1:',
    () => '2026-10-01'
  );
  store.set(
    'phoenix:abrechnung:v1:evt_Sola26',
    JSON.stringify({
      session: { zusatztag: true },
      savedAt: '2026-09-30T10:00:00Z',
      deleteAfter: '2026-12-11',
    })
  );
  assert.equal(zugriff.readLegacy('evt_Sola26')?.session.zusatztag, true);
  assert.equal(zugriff.readLegacy('evt_Anderes'), null);
  assert.equal(store.size, 1);
  zugriff.removeLegacy('evt_Sola26');
  assert.equal(store.size, 0);
  // Storage that cannot be reached reads as nothing
  const gesperrt = legacyZugriff(
    () => {
      throw new Error('gesperrt');
    },
    'phoenix:abrechnung:v1:',
    () => '2026-10-01'
  );
  assert.equal(gesperrt.readLegacy('evt_Sola26'), null);
});
