import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpRequest } from '@azure/functions';
import * as campflow from '../lib/campflow';
import { loadNamiMitglieder, NamiError, resetNamiLoad } from '../lib/nami';
import { GetInternNamiAbgleichEndpoint } from '../endpoints/intern-nami-abgleich';

const BASE = 'https://nami.dpsg.de/ica/rest';
const LIST = `${BASE}/nami/mitglied/filtered-for-navigation/gruppierung/gruppierung/131912`;

interface Call {
  url: string;
  method: string;
}

/** A NaMi that answers like the real one: login with a redirect, then lists and single views. */
function fakeNami(t: test.TestContext, { refuse = false } = {}): Call[] {
  const calls: Call[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    calls.push({ url, method });
    const json = (body: unknown, headers: Record<string, string> = {}): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', ...headers },
      });
    if (url.endsWith('/nami/auth/manual/sessionStartup')) {
      return new Response(null, {
        status: 302,
        headers: {
          location:
            'http://nami.dpsg.de/ica/rest/nami/auth/loginActivatin/abc/API?redirectTo=.%2Fapp.jsp',
          'set-cookie': 'JSESSIONID=s1; Path=/ica',
        },
      });
    }
    if (url.includes('/loginActivatin/')) {
      return json({ statusCode: refuse ? 3000 : 0 });
    }
    if (url.endsWith('/nami/auth/logout')) return json({ success: true });
    if (url.startsWith(`${LIST}/flist`)) {
      return json({
        success: true,
        data: [
          {
            id: 7,
            entries_mitgliedsNummer: 7,
            entries_vorname: 'Anna',
            entries_nachname: 'Muster',
            entries_geburtsDatum: '2015-03-01 00:00:00',
            entries_status: 'Aktiv',
            entries_stufe: 'Wölfling',
            entries_telefon1: '08063 1',
            entries_telefon2: '',
            entries_kontoverbindung: { iban: 'DE02…' },
          },
          { id: 'kaputt' },
        ],
      });
    }
    if (url === `${LIST}/7`) {
      return json({
        success: true,
        data: { strasse: 'Hauptstr. 3', plz: '83620', ort: 'Feldkirchen', kontoverbindung: {} },
      });
    }
    return json({ success: false, message: 'Session expired' });
  });
  return calls;
}

test('NaMi is read with GET only, after the login and its activation', async (t) => {
  process.env.NAMI_USERNAME = '123456';
  process.env.NAMI_PASSWORD = 'geheim';
  t.after(() => {
    delete process.env.NAMI_USERNAME;
    delete process.env.NAMI_PASSWORD;
  });
  const calls = fakeNami(t);

  const members = await loadNamiMitglieder();

  assert.deepEqual(
    calls.filter((c) => c.method !== 'GET').map((c) => c.url),
    [`${BASE}/nami/auth/manual/sessionStartup`]
  );
  // The activation stays on https, though NaMi names http
  assert.ok(
    calls.some((c) => c.url.startsWith('https://nami.dpsg.de/ica/rest/nami/auth/loginActivatin/'))
  );
  assert.equal(calls.at(-1)?.url, `${BASE}/nami/auth/logout`);
  assert.equal(members.length, 1);
  assert.deepEqual(members[0].adresse, {
    strasse: 'Hauptstr. 3',
    plz: '83620',
    ort: 'Feldkirchen',
  });
  assert.equal(members[0].geburtsdatum, '2015-03-01');
  assert.deepEqual(members[0].telefon, ['08063 1']);
  assert.equal('kontoverbindung' in members[0], false);
});

test('a refused or missing login is a NamiError 401', async (t) => {
  fakeNami(t, { refuse: true });
  await assert.rejects(
    loadNamiMitglieder(),
    (error) => error instanceof NamiError && error.status === 401
  );
  process.env.NAMI_USERNAME = '123456';
  process.env.NAMI_PASSWORD = 'falsch';
  t.after(() => {
    delete process.env.NAMI_USERNAME;
    delete process.env.NAMI_PASSWORD;
  });
  await assert.rejects(
    loadNamiMitglieder(),
    (error) => error instanceof NamiError && error.status === 401
  );
});

test('an answer whose body stalls runs into the time limit', async (t) => {
  process.env.NAMI_USERNAME = '123456';
  process.env.NAMI_PASSWORD = 'geheim';
  t.after(() => {
    delete process.env.NAMI_USERNAME;
    delete process.env.NAMI_PASSWORD;
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async (_input: string | URL, init: RequestInit = {}) => {
    // The headers arrive at once, the body never ends until the request is cancelled
    const body = new ReadableStream({
      start(controller) {
        init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
      },
    });
    return new Response(body, { status: 200 });
  });

  const loading = loadNamiMitglieder();
  const failed = assert.rejects(
    loading,
    (error) => error instanceof NamiError && error.status === 504
  );
  // Let the request reach the body before the time runs out
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(15_000);
  await failed;
});

test('single views that hang end with the time budget, the members without address', async (t) => {
  process.env.NAMI_USERNAME = '123456';
  process.env.NAMI_PASSWORD = 'geheim';
  t.after(() => {
    delete process.env.NAMI_USERNAME;
    delete process.env.NAMI_PASSWORD;
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const json = (body: unknown): Response =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.endsWith('/sessionStartup')) {
      return new Response(null, {
        status: 302,
        headers: {
          location: `${BASE}/nami/auth/loginActivatin/abc/API`,
          'set-cookie': 'JSESSIONID=s1; Path=/ica',
        },
      });
    }
    if (url.includes('/loginActivatin/')) return json({ statusCode: 0 });
    if (url.endsWith('/nami/auth/logout')) return json({ success: true });
    if (url.startsWith(`${LIST}/flist`)) {
      const data = Array.from({ length: 85 }, (_, i) => ({ id: i + 1, entries_vorname: `P${i}` }));
      return json({ success: true, data });
    }
    // Single views never answer until they are cancelled
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  });

  const loading = loadNamiMitglieder();
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(30_000);
  const members = await loading;

  assert.equal(members.length, 85);
  assert.ok(members.every((member) => member.adresse === null));
});

function request(roles: string[]): HttpRequest {
  const principal = {
    identityProvider: 'aad',
    userId: 'u',
    userDetails: 'u@example.test',
    userRoles: ['authenticated', 'team_leitende', ...roles],
  };
  return new HttpRequest({
    url: 'https://example.test/api/intern/nami-abgleich',
    method: 'GET',
    headers: { 'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64') },
  });
}

test('only the teams Admin and Vorstand see the comparison', async (t) => {
  resetNamiLoad();
  const response = await GetInternNamiAbgleichEndpoint(request(['team_kasse']));
  assert.equal(response.status, 403);

  t.mock.method(campflow, 'getCampflowMembersWithTime', async () => ({
    value: [],
    loadedAt: new Date(),
  }));
  const allowed = await GetInternNamiAbgleichEndpoint(request(['team_admin']));
  // Without a NaMi login configured the answer names the login, not a server error
  assert.equal(allowed.status, 502);
  assert.equal((allowed.jsonBody as { code: string }).code, 'NAMI_FORBIDDEN');
});
