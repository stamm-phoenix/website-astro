import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import type { HttpResponseInit } from '@azure/functions';
import { AbstimmungAbstimmen, AbstimmungAnsehen } from '../endpoints/abstimmungen';
import {
  AbstimmungEinladungEndpoint,
  AbstimmungErinnerungEndpoint,
  AbstimmungItemEndpoint,
  AbstimmungMailsEndpoint,
  AbstimmungStimmeEndpoint,
  AbstimmungenCollectionEndpoint,
  abstimmungQuellen,
} from '../endpoints/intern-pflege-abstimmungen';
import { abstimmungEinsicht, abstimmungErgebnis } from '../lib/abstimmung-model';
import {
  validateAbstimmung,
  validateAbstimmungName,
  validateAntwort,
} from '../lib/abstimmung-schema';
import type { AbstimmungAnsicht, AbstimmungDetail } from '../lib/abstimmung-model';
import { abstimmungMail, abstimmungMailContent } from '../lib/abstimmung-mails';
import { abstimmungLesen as lesen } from '../lib/abstimmungen';
import type { AbstimmungMailDaten } from '../lib/abstimmung-mails';
import { getDb } from '../lib/db';
import { ValidationError } from '../lib/validation/errors';
import * as personen from '../lib/personen';
import { audienceVersion, protokollRecipients } from '../lib/protokolle';
import * as taskDirectory from '../lib/task-directory';
import { dbTest } from './fixtures/database';

function principal(login: string): Record<string, unknown> {
  return {
    identityProvider: 'aad',
    userId: login,
    userDetails: login,
    userRoles: ['authenticated', 'team_leitende'],
  };
}

const ANNA = 'anna@example.test';
const BEN = 'ben@example.test';

function request(
  method: string,
  url: string,
  options: { body?: unknown; login?: string; id?: number; ifMatch?: string } = {}
): HttpRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.login) {
    headers['x-ms-client-principal'] = Buffer.from(
      JSON.stringify(principal(options.login))
    ).toString('base64');
  }
  if (options.ifMatch) headers['if-match'] = options.ifMatch;
  return new HttpRequest({
    url: `http://localhost/api/${url}`,
    method,
    headers,
    params: options.id === undefined ? {} : { id: String(options.id) },
    ...(options.body === undefined ? {} : { body: { string: JSON.stringify(options.body) } }),
  });
}

function context(t: TestContext): InvocationContext {
  const value = new InvocationContext({ functionName: 'abstimmungen-test' });
  t.mock.method(value, 'log', () => undefined);
  t.mock.method(value, 'error', () => undefined);
  return value;
}

/** No CampFlow link and no Entra group in the tests: names come from the login. */
function offline(t: TestContext): void {
  t.mock.method(personen, 'eigeneAdresse', async () => ({ email: '', geteilt: false }));
  t.mock.method(personen, 'mitEigenerAdresse', async (_login: string, list: unknown[]) => list);
  t.mock.method(taskDirectory, 'getTaskDirectoryUsers', async () => [
    { name: 'Anna Alt', login: ANNA, givenName: 'Anna' },
    { name: 'Ben Bau', login: BEN, givenName: 'Ben' },
  ]);
}

const FORM = {
  titel: 'Termin Weihnachtsfeier',
  beschreibung: 'Bitte alle passenden Termine wählen.',
  optionen: [{ text: 'Fr, 11.12.' }, { text: 'Sa, 12.12.' }, { text: 'Fr, 18.12.' }],
};

async function create(t: TestContext, form: object = FORM): Promise<number> {
  const response = await AbstimmungenCollectionEndpoint(
    request('POST', 'intern/pflege/abstimmungen', { body: form, login: ANNA }),
    context(t)
  );
  assert.equal(response.status, 201, JSON.stringify(response.jsonBody));
  return (response.jsonBody as { id: number }).id;
}

async function detail(t: TestContext, id: number, login = ANNA): Promise<AbstimmungDetail> {
  const response = await AbstimmungItemEndpoint(
    request('GET', `intern/pflege/abstimmungen/${id}`, { login, id }),
    context(t)
  );
  assert.equal(response.status, 200);
  return response.jsonBody as AbstimmungDetail;
}

async function vote(
  t: TestContext,
  id: number,
  login: string,
  gewaehlt: number[],
  vielleicht?: number[]
): Promise<HttpResponseInit> {
  return AbstimmungStimmeEndpoint(
    request('PUT', `intern/pflege/abstimmungen/${id}/stimme`, {
      body: { gewaehlt, vielleicht },
      login,
      id,
    }),
    context(t)
  );
}

/** Saves the form with new settings, keeping the options. */
async function einstellen(
  t: TestContext,
  id: number,
  settings: Record<string, unknown>
): Promise<HttpResponseInit> {
  const view = await detail(t, id);
  return AbstimmungItemEndpoint(
    request('PATCH', `intern/pflege/abstimmungen/${id}`, {
      body: {
        ...FORM,
        maxAuswahl: view.maxAuswahl,
        vielleichtErlaubt: view.vielleichtErlaubt,
        sichtbarkeit: view.sichtbarkeit,
        ...settings,
        etag: view.etag,
        optionen: view.optionen.map(({ id: optionId, text }) => ({ id: optionId, text })),
      },
      login: ANNA,
      id,
    }),
    context(t)
  );
}

function linkToken(link: string | null): string {
  const match = /#link=([A-Za-z0-9_-]{43})$/.exec(link ?? '');
  assert.ok(match, `no shared link in ${link}`);
  return match[1];
}

test('validateAbstimmung leaves out empty rows and refuses duplicates and single options', () => {
  const input = validateAbstimmung({
    titel: '  Pizza oder Döner?  ',
    optionen: [{ text: 'Pizza' }, { text: '  ' }, { text: 'Döner' }],
  });
  assert.equal(input.titel, 'Pizza oder Döner?');
  // Any number of options, no „Vielleicht“, everyone sees the answers
  assert.equal(input.maxAuswahl, null);
  assert.equal(input.vielleichtErlaubt, false);
  assert.equal(input.sichtbarkeit, 'offen');
  const settings = validateAbstimmung({
    titel: 'X',
    maxAuswahl: 2,
    vielleichtErlaubt: true,
    sichtbarkeit: 'geheim',
    optionen: [{ text: 'A' }, { text: 'B' }],
  });
  assert.deepEqual(
    [settings.maxAuswahl, settings.vielleichtErlaubt, settings.sichtbarkeit],
    [2, true, 'geheim']
  );
  for (const maxAuswahl of [0, 1.5, '2', 41]) {
    assert.throws(
      () =>
        validateAbstimmung({ titel: 'X', maxAuswahl, optionen: [{ text: 'A' }, { text: 'B' }] }),
      (error: unknown) => error instanceof ValidationError && 'maxAuswahl' in error.fields
    );
  }
  assert.throws(
    () =>
      validateAbstimmung({
        titel: 'X',
        sichtbarkeit: 'alle',
        optionen: [{ text: 'A' }, { text: 'B' }],
      }),
    (error: unknown) => error instanceof ValidationError && 'sichtbarkeit' in error.fields
  );
  assert.deepEqual(input.optionen, [{ text: 'Pizza' }, { text: 'Döner' }]);
  assert.throws(
    () => validateAbstimmung({ titel: 'X', optionen: [{ text: 'Pizza' }, { text: 'pizza' }] }),
    (error: unknown) => error instanceof ValidationError && /zweimal/.test(error.fields.optionen)
  );
  assert.throws(
    () => validateAbstimmung({ titel: 'X', optionen: [{ text: 'Pizza' }] }),
    (error: unknown) =>
      error instanceof ValidationError && /mindestens zwei/.test(error.fields.optionen)
  );
  assert.throws(() => validateAbstimmung({ titel: ' ', optionen: [] }), ValidationError);
  assert.throws(() => validateAbstimmungName('   '), ValidationError);
  assert.equal(validateAbstimmungName(' Lea   Muster '), 'Lea Muster');
});

test('validateAntwort keeps the order of the options and honors the rules', () => {
  const regeln = { optionIds: [1, 2, 3], maxAuswahl: null, vielleichtErlaubt: true };
  assert.deepEqual(validateAntwort([3, 1], [2], regeln), { gewaehlt: [1, 3], vielleicht: [2] });
  assert.deepEqual(validateAntwort([], undefined, { ...regeln, maxAuswahl: 1 }), {
    gewaehlt: [],
    vielleicht: [],
  });
  const field = (pattern: RegExp) => (error: unknown) =>
    error instanceof ValidationError && pattern.test(error.fields.gewaehlt);
  assert.throws(() => validateAntwort([1, 2], [], { ...regeln, maxAuswahl: 1 }), field(/nur eine/));
  assert.throws(
    () => validateAntwort([1, 2, 3], [], { ...regeln, maxAuswahl: 2 }),
    field(/höchstens 2 Optionen/)
  );
  // „Vielleicht“ does not count against the limit
  assert.deepEqual(validateAntwort([1], [2, 3], { ...regeln, maxAuswahl: 1 }), {
    gewaehlt: [1],
    vielleicht: [2, 3],
  });
  assert.throws(
    () => validateAntwort([1], [2], { ...regeln, vielleichtErlaubt: false }),
    field(/Vielleicht/)
  );
  assert.throws(() => validateAntwort([1], [1], regeln), field(/ungültig/));
  assert.throws(() => validateAntwort([9], [], regeln), field(/gibt es nicht mehr/));
  assert.throws(() => validateAntwort('1', [], regeln), ValidationError);
});

test('abstimmungErgebnis counts the votes per option and shows the answers by Einsicht', () => {
  const daten = {
    id: 1,
    titel: 'T',
    beschreibung: '',
    maxAuswahl: null,
    vielleichtErlaubt: true,
    sichtbarkeit: 'anonym' as const,
    geschlossen: false,
    erstelltVonName: 'Anna',
    optionen: [
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ],
    antworten: [
      { teilnahmeId: 5, name: 'Lea', gewaehlt: [1, 2], vielleicht: [] },
      { teilnahmeId: 6, name: 'Max', gewaehlt: [2], vielleicht: [1] },
      { teilnahmeId: 7, name: 'Kim', gewaehlt: [], vielleicht: [] },
    ],
  };
  const ergebnis = abstimmungErgebnis(daten, 'alles');
  assert.deepEqual(
    ergebnis.optionen.map((option) => [option.stimmen, option.vielleicht]),
    [
      [1, 1],
      [2, 0],
    ]
  );
  assert.deepEqual(ergebnis.antworten[1], { name: 'Max', gewaehlt: [2], vielleicht: [1] });
  assert.equal(ergebnis.anzahlAntworten, 3);
  // Only who answered: the counts stay, the choices of each person go
  const namen = abstimmungErgebnis(daten, 'namen');
  assert.deepEqual(namen.optionen, ergebnis.optionen);
  assert.deepEqual(namen.antworten[1], { name: 'Max', gewaehlt: [], vielleicht: [] });
  // With fewer than three answers the counts would show single choices: held back
  const wenige = { ...daten, antworten: daten.antworten.slice(0, 2) };
  const verborgen = abstimmungErgebnis(wenige, 'namen');
  assert.equal(verborgen.zahlenVerborgen, true);
  assert.deepEqual(
    verborgen.optionen.map((option) => [option.stimmen, option.vielleicht]),
    [
      [0, 0],
      [0, 0],
    ]
  );
  assert.equal(abstimmungErgebnis(wenige, 'alles').zahlenVerborgen, false);
  assert.equal(namen.zahlenVerborgen, false);
  // Only how many answered
  const anzahl = abstimmungErgebnis(daten, 'anzahl');
  assert.deepEqual(anzahl.antworten, []);
  assert.equal(anzahl.anzahlAntworten, 3);
  assert.deepEqual(
    [abstimmungEinsicht('offen', false), abstimmungEinsicht('anonym', false)],
    ['alles', 'namen']
  );
  assert.deepEqual(
    [abstimmungEinsicht('geheim', false), abstimmungEinsicht('geheim', true)],
    ['anzahl', 'alles']
  );
});

test('the mail escapes the text and carries the personal link', () => {
  const data: AbstimmungMailDaten = {
    art: 'einladung',
    name: 'Lea Muster',
    familie: false,
    titel: 'Pizza <oder> Döner',
    beschreibung: 'Zeile 1\nZeile 2',
    organisatorName: 'Anna Alt',
    organisatorLogin: ANNA,
    url: 'https://www.stamm-phoenix.de/abstimmung#t=abc',
  };
  const einladung = abstimmungMailContent(data);
  assert.equal(einladung.subject, 'Abstimmung: Pizza <oder> Döner');
  assert.match(einladung.html, /Hallo Lea,/);
  assert.match(einladung.html, /Pizza &lt;oder&gt; Döner/);
  assert.match(einladung.html, /Zeile 1<br \/>Zeile 2/);
  assert.match(einladung.html, /abstimmung#t=abc/);
  const erinnerung = abstimmungMailContent({ ...data, art: 'erinnerung', name: '' });
  assert.equal(erinnerung.subject, 'Erinnerung: Pizza <oder> Döner');
  assert.match(erinnerung.html, /Hallo,/);
  assert.match(erinnerung.html, /noch nicht mitgemacht/);
});

dbTest('leaders vote, others vote over the shared link, only the organizer manages', async (t) => {
  offline(t);
  const id = await create(t);

  let view = await detail(t, id);
  assert.equal(view.eigene, true);
  assert.equal(view.erstelltVonName, 'Anna Alt');
  const [fr11, sa12, fr18] = view.optionen.map((option) => option.id);
  const token = linkToken(view.link);

  assert.equal((await vote(t, id, ANNA, [fr11, fr18])).status, 204);
  assert.equal((await vote(t, id, BEN, [sa12, fr18])).status, 204);
  // A second answer replaces the first
  assert.equal((await vote(t, id, BEN, [fr18])).status, 204);

  const ben = await detail(t, id, BEN);
  assert.equal(ben.eigene, false);
  assert.equal(ben.link, null);
  assert.equal(ben.teilnahmen, null);
  assert.deepEqual(ben.ich, {
    name: 'Ben Bau',
    gewaehlt: [fr18],
    vielleicht: [],
    geantwortet: true,
  });
  assert.deepEqual(
    ben.optionen.map((option) => option.stimmen),
    [1, 0, 2]
  );

  // Someone outside enters a name over the shared link and gets a personal link back
  const ansehen = await AbstimmungAnsehen(
    request('POST', 'abstimmungen/ansehen', { body: { link: token } }),
    context(t)
  );
  assert.equal(ansehen.status, 200);
  assert.equal((ansehen.jsonBody as AbstimmungAnsicht).ich, null);
  assert.equal((ansehen.headers as Record<string, string>)['Cache-Control'], 'no-store');
  const saved = await AbstimmungAbstimmen(
    request('PUT', 'abstimmungen/stimme', {
      body: { link: token, name: 'Oma Erna', gewaehlt: [sa12] },
    }),
    context(t)
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.jsonBody));
  const personal = (saved.jsonBody as { token: string }).token;
  assert.match(personal, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(personal, token);
  await AbstimmungAbstimmen(
    request('PUT', 'abstimmungen/stimme', {
      body: { token: personal, name: 'Oma Erna', gewaehlt: [sa12, fr18] },
    }),
    context(t)
  );
  const own = await AbstimmungAnsehen(
    request('POST', 'abstimmungen/ansehen', { body: { token: personal } }),
    context(t)
  );
  const ownView = own.jsonBody as AbstimmungAnsicht;
  assert.deepEqual(ownView.ich, {
    name: 'Oma Erna',
    gewaehlt: [sa12, fr18],
    vielleicht: [],
    geantwortet: true,
  });
  assert.deepEqual(
    ownView.antworten.map((antwort) => antwort.name),
    ['Anna Alt', 'Ben Bau', 'Oma Erna']
  );
  // Neither addresses nor tokens of others reach the public page
  assert.doesNotMatch(JSON.stringify(ownView), /example\.test|token/);

  const wrong = await AbstimmungAnsehen(
    request('POST', 'abstimmungen/ansehen', { body: { link: 'x'.repeat(43) } }),
    context(t)
  );
  assert.equal(wrong.status, 404);

  // Only Anna may change it
  view = await detail(t, id);
  const forbidden = await AbstimmungItemEndpoint(
    request('PATCH', `intern/pflege/abstimmungen/${id}`, {
      body: { etag: view.etag, geschlossen: true },
      login: BEN,
      id,
    }),
    context(t)
  );
  assert.equal(forbidden.status, 403);

  // A single choice is refused while people chose several
  const single = await AbstimmungItemEndpoint(
    request('PATCH', `intern/pflege/abstimmungen/${id}`, {
      body: {
        ...FORM,
        etag: view.etag,
        maxAuswahl: 1,
        optionen: view.optionen.map(({ id: optionId, text }) => ({ id: optionId, text })),
      },
      login: ANNA,
      id,
    }),
    context(t)
  );
  assert.equal(single.status, 400);

  // Removing an option removes its votes; a new one starts without
  const remove = (bekannteStimmen: Record<number, number>) =>
    AbstimmungItemEndpoint(
      request('PATCH', `intern/pflege/abstimmungen/${id}`, {
        body: {
          ...FORM,
          etag: view.etag,
          optionen: [
            { id: fr18, text: 'Fr, 18.12. ab 19 Uhr' },
            { id: sa12, text: 'Sa, 12.12.' },
            { text: 'So, 13.12.' },
          ],
          bekannteStimmen,
        },
        login: ANNA,
        id,
      }),
      context(t)
    );
  // The form showed no vote for Fr, 11.12., but Anna voted for it: nothing is deleted
  const unwarned = await remove({ [fr11]: 0 });
  assert.equal(unwarned.status, 400);
  assert.match(
    (unwarned.jsonBody as { fields: { optionen: string } }).fields.optionen,
    /Inzwischen hat jemand für „Fr, 11.12.“ gestimmt/
  );
  const edited = await remove({ [fr11]: 1 });
  assert.equal(edited.status, 204, JSON.stringify(edited.jsonBody));
  view = await detail(t, id);
  assert.deepEqual(
    view.optionen.map((option) => [option.text, option.stimmen]),
    [
      ['Fr, 18.12. ab 19 Uhr', 3],
      ['Sa, 12.12.', 1],
      ['So, 13.12.', 0],
    ]
  );
  assert.deepEqual(view.ich?.gewaehlt, [fr18]);

  // A stale version is a conflict
  const stale = await AbstimmungItemEndpoint(
    request('PATCH', `intern/pflege/abstimmungen/${id}`, {
      body: { etag: ben.etag, geschlossen: true },
      login: ANNA,
      id,
    }),
    context(t)
  );
  assert.equal(stale.status, 409);

  // Ended: nobody can vote any more, the result stays
  const closed = await AbstimmungItemEndpoint(
    request('PATCH', `intern/pflege/abstimmungen/${id}`, {
      body: { etag: view.etag, geschlossen: true },
      login: ANNA,
      id,
    }),
    context(t)
  );
  assert.equal(closed.status, 204);
  assert.equal((await vote(t, id, BEN, [])).status, 409);
  const late = await AbstimmungAbstimmen(
    request('PUT', 'abstimmungen/stimme', {
      body: { token: personal, name: 'Oma Erna', gewaehlt: [] },
    }),
    context(t)
  );
  assert.equal(late.status, 409);

  const list = await AbstimmungenCollectionEndpoint(
    request('GET', 'intern/pflege/abstimmungen', { login: BEN }),
    context(t)
  );
  assert.deepEqual(
    (
      list.jsonBody as {
        geschlossen: boolean;
        antworten: number;
        ichGeantwortet: boolean;
        eigene: boolean;
      }[]
    ).map(({ geschlossen, antworten, ichGeantwortet, eigene }) => ({
      geschlossen,
      antworten,
      ichGeantwortet,
      eigene,
    })),
    [{ geschlossen: true, antworten: 3, ichGeantwortet: true, eigene: false }]
  );

  view = await detail(t, id);
  const deleted = await AbstimmungItemEndpoint(
    request('DELETE', `intern/pflege/abstimmungen/${id}`, { login: ANNA, id, ifMatch: view.etag }),
    context(t)
  );
  assert.equal(deleted.status, 204);
  assert.equal((await getDb().selectFrom('abstimmung.teilnahme').select('id').execute()).length, 0);
});

const MEMBERS = [
  {
    id: 'per_anna',
    name: { first_name: 'Anna', last_name: 'Alt' },
    primary_email: ANNA,
    group_names: ['🐦‍🔥 Leiter*in'],
  },
  {
    id: 'per_ben',
    name: { first_name: 'Ben', last_name: 'Bau' },
    primary_email: 'ben.privat@example.test',
    group_names: ['🐦‍🔥 Leiter*in'],
  },
  {
    id: 'per_erika',
    name: { first_name: 'Erika', last_name: 'Eltern' },
    primary_email: 'erika@example.test',
    label_names: ['📄 Protokollempfang'],
  },
];

dbTest('invitations and reminders go out one by one with the personal link', async (t) => {
  offline(t);
  t.mock.method(abstimmungQuellen, 'members', async () => MEMBERS);
  t.mock.method(abstimmungQuellen, 'personen', async () => []);
  const sent: { to: string; data: AbstimmungMailDaten }[] = [];
  const send = t.mock.method(
    abstimmungMail,
    'send',
    async (to: string, data: AbstimmungMailDaten) => {
      sent.push({ to, data });
    }
  );
  const id = await create(t);
  const post = (path: string, body: unknown, login = ANNA): Promise<HttpResponseInit> => {
    const endpoint = {
      einladung: AbstimmungEinladungEndpoint,
      erinnerung: AbstimmungErinnerungEndpoint,
      mails: AbstimmungMailsEndpoint,
    }[path]!;
    return endpoint(
      request('POST', `intern/pflege/abstimmungen/${id}/${path}`, { body, login, id }),
      context(t)
    );
  };

  assert.equal((await post('einladung', { action: 'preview' }, BEN)).status, 403);
  const preview = await post('einladung', { action: 'preview' });
  assert.equal(preview.status, 200);
  const version = (preview.jsonBody as { version: string }).version;
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
  assert.equal(
    version,
    audienceVersion(protokollRecipients(MEMBERS, today, ['Leiter*in'], ['Protokollempfang']))
  );

  const stale = await post('einladung', { action: 'send', version: 'alt' });
  assert.equal(stale.status, 400);
  const queued = await post('einladung', {
    action: 'send',
    version,
    excluded: [ANNA],
    extra: ['gast@example.test'],
  });
  assert.equal(queued.status, 200, JSON.stringify(queued.jsonBody));
  assert.deepEqual(queued.jsonBody, { neu: 3, schon: 0, offen: 3, gesendet: 0, unklar: 0 });
  assert.equal(send.mock.callCount(), 0);

  const step = await post('mails', {});
  assert.deepEqual(step.jsonBody, { offen: 0, gesendet: 3, unklar: 0 });
  assert.deepEqual(
    sent.map((mail) => [mail.to, mail.data.art, mail.data.name]),
    [
      ['ben.privat@example.test', 'einladung', 'Ben Bau'],
      ['erika@example.test', 'einladung', 'Erika Eltern'],
      ['gast@example.test', 'einladung', ''],
    ]
  );
  assert.ok(sent.every((mail) => /\/abstimmung#t=[A-Za-z0-9_-]{43}$/.test(mail.data.url)));
  assert.equal(sent[0].data.organisatorLogin, ANNA);

  // Inviting again adds nobody twice
  const again = await post('einladung', { action: 'send', version, excluded: [ANNA] });
  assert.equal((again.jsonBody as { neu: number; schon: number }).neu, 0);
  assert.equal((again.jsonBody as { neu: number; schon: number }).schon, 2);

  // Ben votes in the Leitendenbereich: the invitation to his CampFlow address becomes his
  t.mock.method(personen, 'eigeneAdresse', async (login: string) =>
    login === BEN
      ? { email: 'ben.privat@example.test', geteilt: false }
      : { email: '', geteilt: false }
  );
  assert.equal((await vote(t, id, BEN, [])).status, 204);
  // Erika answers with her personal link
  const erika = new URL(sent[1].data.url).hash.slice(3);
  const answer = await AbstimmungAbstimmen(
    request('PUT', 'abstimmungen/stimme', {
      body: { token: erika, name: 'Erika Eltern', gewaehlt: [] },
    }),
    context(t)
  );
  assert.equal(answer.status, 200);

  const view = await detail(t, id);
  assert.deepEqual(
    view.teilnahmen?.map((teilnahme) => [teilnahme.email, teilnahme.geantwortet]),
    [
      ['ben.privat@example.test', true],
      ['erika@example.test', true],
      ['gast@example.test', false],
    ]
  );

  // The reminder goes only to the guest, who has not answered
  assert.deepEqual((await post('erinnerung', { action: 'preview' })).jsonBody, { personen: 1 });
  sent.length = 0;
  send.mock.mockImplementation(async () => {
    throw new Error('Graph down');
  });
  await post('erinnerung', { action: 'send' });
  const failed = await post('mails', {});
  assert.equal(failed.status, 502);
  // Unclear whether it went out: never sent again automatically
  const unclear = await post('mails', {});
  assert.deepEqual(unclear.jsonBody, { offen: 0, gesendet: 2, unklar: 1 });
  assert.equal(send.mock.callCount(), 4);

  // A later reminder covers the unclear one
  send.mock.mockImplementation(async (to: string, data: AbstimmungMailDaten) => {
    sent.push({ to, data });
  });
  await post('erinnerung', { action: 'send' });
  await post('mails', {});
  assert.deepEqual(
    sent.map((mail) => [mail.to, mail.data.art]),
    [['gast@example.test', 'erinnerung']]
  );
  const after = await detail(t, id);
  assert.ok(
    after.teilnahmen?.find((teilnahme) => teilnahme.email === 'gast@example.test')?.erinnertAm
  );
});

dbTest('a leader who answered here is not invited or reminded again', async (t) => {
  offline(t);
  t.mock.method(abstimmungQuellen, 'members', async () => MEMBERS);
  t.mock.method(abstimmungQuellen, 'personen', async () => []);
  // Ben's linked CampFlow person has another address than his login
  t.mock.method(personen, 'eigeneAdresse', async (login: string) =>
    login === BEN
      ? { email: 'ben.privat@example.test', geteilt: false }
      : { email: '', geteilt: false }
  );
  const sent: string[] = [];
  t.mock.method(abstimmungMail, 'send', async (to: string) => {
    sent.push(to);
  });
  const id = await create(t);
  const [first] = (await detail(t, id)).optionen.map((option) => option.id);
  assert.equal((await vote(t, id, ANNA, [first])).status, 204);
  assert.equal((await vote(t, id, BEN, [first])).status, 204);

  const post = (path: 'einladung' | 'erinnerung' | 'mails', body: unknown) =>
    ({
      einladung: AbstimmungEinladungEndpoint,
      erinnerung: AbstimmungErinnerungEndpoint,
      mails: AbstimmungMailsEndpoint,
    })[path](
      request('POST', `intern/pflege/abstimmungen/${id}/${path}`, { body, login: ANNA, id }),
      context(t)
    );
  const preview = await post('einladung', { action: 'preview' });
  const { version, eingeladen } = preview.jsonBody as { version: string; eingeladen: string[] };
  assert.ok(eingeladen.includes('ben.privat@example.test'));
  const queued = await post('einladung', { action: 'send', version });
  // Anna by her login, Ben by his CampFlow address; only Erika is new
  assert.deepEqual(
    {
      neu: (queued.jsonBody as { neu: number }).neu,
      schon: (queued.jsonBody as { schon: number }).schon,
    },
    { neu: 1, schon: 2 }
  );
  await post('mails', {});
  assert.deepEqual(sent, ['erika@example.test']);
  assert.deepEqual((await post('erinnerung', { action: 'preview' })).jsonBody, { personen: 1 });

  const view = await detail(t, id);
  assert.deepEqual(
    view.antworten.map((antwort) => antwort.name),
    ['Anna Alt', 'Ben Bau']
  );
  assert.equal(view.optionen[0].stimmen, 2);
});

dbTest('a reminder waits for a mail that is being sent', async (t) => {
  offline(t);
  t.mock.method(abstimmungQuellen, 'members', async () => MEMBERS.slice(2));
  t.mock.method(abstimmungQuellen, 'personen', async () => []);
  let release: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  const sent: string[] = [];
  t.mock.method(abstimmungMail, 'send', async (to: string, data: AbstimmungMailDaten) => {
    if (data.art === 'einladung') await blocked;
    sent.push(`${data.art}:${to}`);
  });
  const id = await create(t);
  const post = (path: 'einladung' | 'erinnerung' | 'mails', body: unknown) =>
    ({
      einladung: AbstimmungEinladungEndpoint,
      erinnerung: AbstimmungErinnerungEndpoint,
      mails: AbstimmungMailsEndpoint,
    })[path](
      request('POST', `intern/pflege/abstimmungen/${id}/${path}`, { body, login: ANNA, id }),
      context(t)
    );
  const { version } = (await post('einladung', { action: 'preview' })).jsonBody as {
    version: string;
  };
  await post('einladung', { action: 'send', version });

  const step = post('mails', {});
  // The invitation is reserved and being sent; a reminder now must wait for it
  while (
    !(await getDb()
      .selectFrom('abstimmung.teilnahme')
      .select('id')
      .where('mail_status', '=', 'versucht')
      .executeTakeFirst())
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  let reminded = false;
  const reminder = post('erinnerung', { action: 'send' }).then((response) => {
    reminded = true;
    return response;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(reminded, false);
  } finally {
    // Even a failed check lets the step finish, so the database can be dropped
    release();
  }
  assert.deepEqual((await step).jsonBody, { offen: 0, gesendet: 1, unklar: 0 });
  await reminder;
  await post('mails', {});
  // The invitation was recorded as sent before the reminder took the row over
  const [row] = await getDb()
    .selectFrom('abstimmung.teilnahme')
    .select(['eingeladen_am', 'erinnert_am', 'mail_status'])
    .execute();
  assert.ok(row.eingeladen_am);
  assert.ok(row.erinnert_am);
  assert.equal(row.mail_status, 'gesendet');
  assert.deepEqual(sent, ['einladung:erika@example.test', 'erinnerung:erika@example.test']);
});

dbTest('a queued reminder is taken back when the person answers', async (t) => {
  offline(t);
  t.mock.method(abstimmungQuellen, 'members', async () => MEMBERS.slice(2));
  t.mock.method(abstimmungQuellen, 'personen', async () => []);
  const sent: { to: string; data: AbstimmungMailDaten }[] = [];
  t.mock.method(abstimmungMail, 'send', async (to: string, data: AbstimmungMailDaten) => {
    sent.push({ to, data });
  });
  const id = await create(t);
  const [first] = (await detail(t, id)).optionen.map((option) => option.id);
  const post = (path: 'einladung' | 'erinnerung' | 'mails', body: unknown) =>
    ({
      einladung: AbstimmungEinladungEndpoint,
      erinnerung: AbstimmungErinnerungEndpoint,
      mails: AbstimmungMailsEndpoint,
    })[path](
      request('POST', `intern/pflege/abstimmungen/${id}/${path}`, { body, login: ANNA, id }),
      context(t)
    );
  const { version } = (await post('einladung', { action: 'preview' })).jsonBody as {
    version: string;
  };
  await post('einladung', { action: 'send', version });
  await post('mails', {});
  assert.deepEqual(
    sent.map((mail) => mail.to),
    ['erika@example.test']
  );
  const token = new URL(sent[0].data.url).hash.slice(3);

  // The reminder is queued, then Erika answers before it goes out
  await post('erinnerung', { action: 'send' });
  await AbstimmungAbstimmen(
    request('PUT', 'abstimmungen/stimme', {
      body: { token, name: 'Erika Muster', gewaehlt: [first] },
    }),
    context(t)
  );
  const stand = await post('mails', {});
  assert.equal(sent.length, 1);
  assert.equal((stand.jsonBody as { offen: number }).offen, 0);
});

dbTest('a family sharing one address answers as separate people', async (t) => {
  offline(t);
  t.mock.method(abstimmungQuellen, 'members', async () => [
    ...MEMBERS,
    {
      id: 'per_clara',
      name: { first_name: 'Clara', last_name: 'Bau' },
      primary_email: 'ben.privat@example.test',
      label_names: ['📄 Protokollempfang'],
    },
  ]);
  t.mock.method(abstimmungQuellen, 'personen', async () => []);
  const sent: { to: string; data: AbstimmungMailDaten }[] = [];
  t.mock.method(abstimmungMail, 'send', async (to: string, data: AbstimmungMailDaten) => {
    sent.push({ to, data });
  });
  const id = await create(t);
  const [first, second] = (await detail(t, id)).optionen.map((option) => option.id);
  const post = (path: 'einladung' | 'mails', body: unknown) =>
    ({ einladung: AbstimmungEinladungEndpoint, mails: AbstimmungMailsEndpoint })[path](
      request('POST', `intern/pflege/abstimmungen/${id}/${path}`, { body, login: ANNA, id }),
      context(t)
    );
  const { version } = (await post('einladung', { action: 'preview' })).jsonBody as {
    version: string;
  };
  await post('einladung', { action: 'send', version, excluded: [ANNA, 'erika@example.test'] });
  await post('mails', {});
  assert.equal(sent.length, 1);
  assert.match(sent[0].data.name, /Ben Bau.*Clara Bau|Clara Bau.*Ben Bau/);
  assert.match(abstimmungMailContent(sent[0].data).html, /Hallo zusammen,/);
  const familie = new URL(sent[0].data.url).hash.slice(3);

  // The link asks everyone of the family for their own name, also after a first answer
  const ansicht = async (token: string): Promise<AbstimmungAnsicht> =>
    (
      await AbstimmungAnsehen(
        request('POST', 'abstimmungen/ansehen', { body: { token } }),
        context(t)
      )
    ).jsonBody as AbstimmungAnsicht;
  const answer = async (token: string, name: string, gewaehlt: number[]): Promise<string> =>
    (
      (
        await AbstimmungAbstimmen(
          request('PUT', 'abstimmungen/stimme', { body: { token, name, gewaehlt } }),
          context(t)
        )
      ).jsonBody as { token: string }
    ).token;
  assert.deepEqual((await ansicht(familie)).ich, {
    name: '',
    gewaehlt: [],
    vielleicht: [],
    geantwortet: false,
  });
  // Everyone who answers with it becomes a person with a link of their own
  const clara = await answer(familie, 'Clara Bau', [first]);
  assert.notEqual(clara, familie);
  assert.deepEqual((await ansicht(familie)).ich, {
    name: '',
    gewaehlt: [],
    vielleicht: [],
    geantwortet: false,
  });
  const ben = await answer(familie, 'Ben', [second]);
  assert.notEqual(ben, clara);
  // Each changes their own answer with their link, also the name
  assert.equal(await answer(clara, 'Clara Bau', [first, second]), clara);
  assert.equal(await answer(ben, 'Ben Bau', [second]), ben);
  // Someone of the family answered: no reminder to the address any more
  assert.deepEqual(
    (
      await AbstimmungErinnerungEndpoint(
        request('POST', `intern/pflege/abstimmungen/${id}/erinnerung`, {
          body: { action: 'preview' },
          login: ANNA,
          id,
        }),
        context(t)
      )
    ).jsonBody,
    { personen: 0 }
  );
  const result = await detail(t, id);
  assert.deepEqual(
    result.antworten.map((antwort) => [antwort.name, antwort.gewaehlt]),
    [
      ['Clara Bau', [first, second]],
      ['Ben Bau', [second]],
    ]
  );
});

dbTest('a corrected name on a personal link stays one answer', async (t) => {
  offline(t);
  const id = await create(t);
  const view = await detail(t, id);
  const [first] = view.optionen.map((option) => option.id);
  const put = async (body: Record<string, unknown>): Promise<string> =>
    (
      (
        await AbstimmungAbstimmen(
          request('PUT', 'abstimmungen/stimme', { body: { gewaehlt: [first], ...body } }),
          context(t)
        )
      ).jsonBody as { token: string }
    ).token;
  const token = await put({ link: linkToken(view.link), name: 'Lea' });
  assert.equal(await put({ token, name: 'Lea Muster' }), token);
  assert.deepEqual(
    (await detail(t, id)).antworten.map((antwort) => antwort.name),
    ['Lea Muster']
  );
});

dbTest('a leader voting first does not hold back the invitation to a family address', async (t) => {
  offline(t);
  t.mock.method(abstimmungQuellen, 'members', async () => [
    ...MEMBERS,
    {
      id: 'per_clara',
      name: { first_name: 'Clara', last_name: 'Bau' },
      primary_email: 'ben.privat@example.test',
      label_names: ['📄 Protokollempfang'],
    },
  ]);
  t.mock.method(abstimmungQuellen, 'personen', async () => []);
  // Ben's CampFlow address is the family's
  t.mock.method(personen, 'eigeneAdresse', async (login: string) =>
    login === BEN
      ? { email: 'ben.privat@example.test', geteilt: true }
      : { email: '', geteilt: false }
  );
  const sent: string[] = [];
  t.mock.method(abstimmungMail, 'send', async (to: string) => {
    sent.push(to);
  });
  const id = await create(t);
  const [first] = (await detail(t, id)).optionen.map((option) => option.id);
  assert.equal((await vote(t, id, BEN, [first])).status, 204);
  const post = (path: 'einladung' | 'mails', body: unknown) =>
    ({ einladung: AbstimmungEinladungEndpoint, mails: AbstimmungMailsEndpoint })[path](
      request('POST', `intern/pflege/abstimmungen/${id}/${path}`, { body, login: ANNA, id }),
      context(t)
    );
  const { version } = (await post('einladung', { action: 'preview' })).jsonBody as {
    version: string;
  };
  await post('einladung', { action: 'send', version, excluded: [ANNA, 'erika@example.test'] });
  await post('mails', {});
  // Clara still gets the invitation to the family address
  assert.deepEqual(sent, ['ben.privat@example.test']);
  // Ben's own answer stays his
  assert.deepEqual((await detail(t, id, BEN)).ich, {
    name: 'Ben Bau',
    gewaehlt: [first],
    vielleicht: [],
    geantwortet: true,
  });
});

dbTest('a repeated first answer over the shared link stays one answer', async (t) => {
  offline(t);
  const id = await create(t);
  const view = await detail(t, id);
  const [first, second] = view.optionen.map((option) => option.id);
  const link = linkToken(view.link);
  const versuch = '0f8e7b52-3c1d-4a6e-9b2f-5d4c3b2a1908';
  const send = (gewaehlt: number[]) =>
    AbstimmungAbstimmen(
      request('PUT', 'abstimmungen/stimme', {
        body: { link, name: 'Oma Erna', gewaehlt, versuch },
      }),
      context(t)
    );
  // The response of the first request is lost; the page sends the same answer again
  const one = (await send([first])).jsonBody as { token: string };
  const two = (await send([first, second])).jsonBody as { token: string };
  assert.equal(two.token, one.token);
  const result = await detail(t, id);
  assert.deepEqual(
    result.antworten.map((antwort) => [antwort.name, antwort.gewaehlt]),
    [['Oma Erna', [first, second]]]
  );
});

dbTest('one request starts no mail it cannot finish in time', async (t) => {
  offline(t);
  t.mock.method(abstimmungQuellen, 'members', async () => MEMBERS);
  t.mock.method(abstimmungQuellen, 'personen', async () => []);
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const send = t.mock.method(abstimmungMail, 'send', async () => {
    // Every mail takes twelve seconds
    now += 12_000;
  });
  const id = await create(t);
  const post = (path: 'einladung' | 'mails', body: unknown) =>
    ({ einladung: AbstimmungEinladungEndpoint, mails: AbstimmungMailsEndpoint })[path](
      request('POST', `intern/pflege/abstimmungen/${id}/${path}`, { body, login: ANNA, id }),
      context(t)
    );
  const { version } = (await post('einladung', { action: 'preview' })).jsonBody as {
    version: string;
  };
  await post('einladung', { action: 'send', version });
  const step = await post('mails', {});
  // 0 s and 12 s may start, at 24 s a mail of up to 10 s would end after the 30 s budget
  assert.equal(send.mock.callCount(), 2);
  assert.deepEqual(step.jsonBody, { offen: 1, gesendet: 2, unklar: 0 });
});

dbTest('own invitations are found by address, a family one belongs to nobody', async (t) => {
  offline(t);
  t.mock.method(abstimmungQuellen, 'members', async () => [
    ...MEMBERS,
    {
      id: 'per_clara',
      name: { first_name: 'Clara', last_name: 'Bau' },
      primary_email: 'familie@example.test',
      label_names: ['📄 Protokollempfang'],
    },
    {
      id: 'per_carl',
      name: { first_name: 'Carl', last_name: 'Bau' },
      primary_email: 'familie@example.test',
      label_names: ['📄 Protokollempfang'],
    },
  ]);
  t.mock.method(abstimmungQuellen, 'personen', async () => []);
  const sent: { to: string; url: string }[] = [];
  t.mock.method(abstimmungMail, 'send', async (to: string, data: AbstimmungMailDaten) => {
    sent.push({ to, url: data.url });
  });
  const id = await create(t);
  const [first] = (await detail(t, id)).optionen.map((option) => option.id);
  const post = (path: 'einladung' | 'mails', body: unknown) =>
    ({ einladung: AbstimmungEinladungEndpoint, mails: AbstimmungMailsEndpoint })[path](
      request('POST', `intern/pflege/abstimmungen/${id}/${path}`, { body, login: ANNA, id }),
      context(t)
    );
  const { version } = (await post('einladung', { action: 'preview' })).jsonBody as {
    version: string;
  };
  await post('einladung', { action: 'send', version, excluded: [ANNA, 'erika@example.test'] });
  await post('mails', {});
  const tokenOf = (to: string): string =>
    new URL(sent.find((mail) => mail.to === to)!.url).hash.slice(3);
  const answer = (token: string, name: string) =>
    AbstimmungAbstimmen(
      request('PUT', 'abstimmungen/stimme', { body: { token, name, gewaehlt: [first] } }),
      context(t)
    );
  // Ben answers his own invitation as „Ben“, then votes here as „Ben Bau“: one answer
  t.mock.method(personen, 'eigeneAdresse', async (login: string) =>
    login === BEN
      ? { email: 'ben.privat@example.test', geteilt: false }
      : { email: 'familie@example.test', geteilt: true }
  );
  await answer(tokenOf('ben.privat@example.test'), 'Ben');
  assert.equal((await vote(t, id, BEN, [first])).status, 204);
  // Clara answers the family invitation; Anna's CampFlow address is that family's in this test
  await answer(tokenOf('familie@example.test'), 'Clara Bau');
  const list = await AbstimmungenCollectionEndpoint(
    request('GET', 'intern/pflege/abstimmungen', { login: ANNA }),
    context(t)
  );
  assert.equal((list.jsonBody as { ichGeantwortet: boolean }[])[0].ichGeantwortet, false);
  assert.equal((await detail(t, id)).ich, null);
  assert.deepEqual(
    (await detail(t, id)).antworten.map((antwort) => antwort.name),
    ['Ben Bau', 'Clara Bau']
  );
});

dbTest('no mail goes out for an ended Abstimmung', async (t) => {
  offline(t);
  t.mock.method(abstimmungQuellen, 'members', async () => MEMBERS);
  t.mock.method(abstimmungQuellen, 'personen', async () => []);
  const send = t.mock.method(abstimmungMail, 'send', async () => undefined);
  const id = await create(t);
  const post = (path: 'einladung' | 'mails', body: unknown) =>
    ({ einladung: AbstimmungEinladungEndpoint, mails: AbstimmungMailsEndpoint })[path](
      request('POST', `intern/pflege/abstimmungen/${id}/${path}`, { body, login: ANNA, id }),
      context(t)
    );
  const { version } = (await post('einladung', { action: 'preview' })).jsonBody as {
    version: string;
  };
  await post('einladung', { action: 'send', version });
  const ende = await AbstimmungItemEndpoint(
    request('PATCH', `intern/pflege/abstimmungen/${id}`, {
      body: { etag: (await detail(t, id)).etag, geschlossen: true },
      login: ANNA,
      id,
    }),
    context(t)
  );
  assert.equal(ende.status, 204);
  assert.equal((await post('mails', {})).status, 409);
  assert.equal(send.mock.callCount(), 0);
});

dbTest('ending an Abstimmung while mails go out stops the next ones', async (t) => {
  offline(t);
  t.mock.method(abstimmungQuellen, 'members', async () => MEMBERS);
  t.mock.method(abstimmungQuellen, 'personen', async () => []);
  let release: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  let calls = 0;
  t.mock.method(abstimmungMail, 'send', async () => {
    if (++calls === 1) await blocked;
  });
  const id = await create(t);
  const post = (path: 'einladung' | 'mails', body: unknown) =>
    ({ einladung: AbstimmungEinladungEndpoint, mails: AbstimmungMailsEndpoint })[path](
      request('POST', `intern/pflege/abstimmungen/${id}/${path}`, { body, login: ANNA, id }),
      context(t)
    );
  const { version } = (await post('einladung', { action: 'preview' })).jsonBody as {
    version: string;
  };
  await post('einladung', { action: 'send', version });
  const step = post('mails', {});
  while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 20));
  const patch = (geschlossen: boolean, etag: string) =>
    AbstimmungItemEndpoint(
      request('PATCH', `intern/pflege/abstimmungen/${id}`, {
        body: { etag, geschlossen },
        login: ANNA,
        id,
      }),
      context(t)
    );
  const ende = patch(true, (await detail(t, id)).etag);
  try {
    await new Promise((resolve) => setTimeout(resolve, 200));
  } finally {
    release();
  }
  assert.equal((await ende).status, 204);
  // The mail under way went out, the others wait for the Abstimmung to open again
  assert.equal((await step).status, 409);
  assert.equal(calls, 1);
  const stand = await getDb()
    .selectFrom('abstimmung.teilnahme')
    .select('mail_status')
    .where('abstimmung_id', '=', id)
    .execute();
  assert.deepEqual(stand.map((row) => row.mail_status).sort(), ['gesendet', 'offen', 'offen']);
  assert.equal((await patch(false, (await detail(t, id)).etag)).status, 204);
  assert.deepEqual((await post('mails', {})).jsonBody, { offen: 0, gesendet: 3, unklar: 0 });
});

dbTest('a vote while CampFlow was not reachable joins the invitation later', async (t) => {
  offline(t);
  t.mock.method(abstimmungQuellen, 'members', async () => MEMBERS);
  t.mock.method(abstimmungQuellen, 'personen', async () => []);
  t.mock.method(abstimmungMail, 'send', async () => undefined);
  let campflow = false;
  t.mock.method(personen, 'eigeneAdresse', async (login: string) =>
    login === BEN && campflow
      ? { email: 'ben.privat@example.test', geteilt: false }
      : { email: '', geteilt: false }
  );
  const id = await create(t);
  const [first, second] = (await detail(t, id)).optionen.map((option) => option.id);
  // CampFlow does not answer: Ben's answer has only his login
  assert.equal((await vote(t, id, BEN, [first])).status, 204);
  const post = (path: 'einladung' | 'erinnerung' | 'mails', body: unknown) =>
    ({
      einladung: AbstimmungEinladungEndpoint,
      erinnerung: AbstimmungErinnerungEndpoint,
      mails: AbstimmungMailsEndpoint,
    })[path](
      request('POST', `intern/pflege/abstimmungen/${id}/${path}`, { body, login: ANNA, id }),
      context(t)
    );
  const { version } = (await post('einladung', { action: 'preview' })).jsonBody as {
    version: string;
  };
  // So the invitation to his CampFlow address is a row of its own
  await post('einladung', { action: 'send', version, excluded: [ANNA, 'erika@example.test'] });
  await post('mails', {});
  // With CampFlow back, Ben's next answer joins both
  campflow = true;
  assert.equal((await vote(t, id, BEN, [second])).status, 204);
  const result = await detail(t, id);
  assert.deepEqual(
    result.antworten.map((antwort) => [antwort.name, antwort.gewaehlt]),
    [['Ben Bau', [second]]]
  );
  assert.deepEqual((await post('erinnerung', { action: 'preview' })).jsonBody, { personen: 0 });
  assert.deepEqual(
    result.teilnahmen?.map((teilnahme) => [teilnahme.email, teilnahme.geantwortet]),
    [['ben.privat@example.test', true]]
  );
});

dbTest('two invitations of one leader both keep their links', async (t) => {
  offline(t);
  t.mock.method(abstimmungQuellen, 'members', async () => MEMBERS);
  t.mock.method(abstimmungQuellen, 'personen', async () => []);
  const sent: { to: string; url: string }[] = [];
  t.mock.method(abstimmungMail, 'send', async (to: string, data: AbstimmungMailDaten) => {
    sent.push({ to, url: data.url });
  });
  t.mock.method(personen, 'eigeneAdresse', async (login: string) =>
    login === BEN
      ? { email: 'ben.privat@example.test', geteilt: false }
      : { email: '', geteilt: false }
  );
  const id = await create(t);
  const [first, second] = (await detail(t, id)).optionen.map((option) => option.id);
  const post = (path: 'einladung' | 'mails', body: unknown) =>
    ({ einladung: AbstimmungEinladungEndpoint, mails: AbstimmungMailsEndpoint })[path](
      request('POST', `intern/pflege/abstimmungen/${id}/${path}`, { body, login: ANNA, id }),
      context(t)
    );
  const { version } = (await post('einladung', { action: 'preview' })).jsonBody as {
    version: string;
  };
  // Ben is invited at his login and at his CampFlow address
  await post('einladung', {
    action: 'send',
    version,
    excluded: [ANNA, 'erika@example.test'],
    extra: [BEN],
  });
  await post('mails', {});
  assert.deepEqual(sent.map((mail) => mail.to).sort(), ['ben.privat@example.test', BEN]);
  assert.equal((await vote(t, id, BEN, [first])).status, 204);
  assert.equal((await vote(t, id, BEN, [second])).status, 204);
  // Every link that went out still opens Ben's one answer and changes it
  for (const [index, mail] of sent.entries()) {
    const token = new URL(mail.url).hash.slice(3);
    const view = await AbstimmungAnsehen(
      request('POST', 'abstimmungen/ansehen', { body: { token } }),
      context(t)
    );
    assert.equal(view.status, 200, mail.to);
    assert.equal((view.jsonBody as AbstimmungAnsicht).ich?.geantwortet, true, mail.to);
    const gewaehlt = index === 0 ? [first, second] : [first];
    const saved = await AbstimmungAbstimmen(
      request('PUT', 'abstimmungen/stimme', { body: { token, name: 'Ben Bau', gewaehlt } }),
      context(t)
    );
    assert.deepEqual(saved.jsonBody, { token }, mail.to);
  }
  // Ben counts once, with his last answer, and gets no reminder at the other address
  const result = await detail(t, id);
  assert.deepEqual(
    result.antworten.map((antwort) => [antwort.name, antwort.gewaehlt]),
    [['Ben Bau', [first]]]
  );
  assert.deepEqual((await detail(t, id, BEN)).ich?.gewaehlt, [first]);
  assert.ok(result.teilnahmen?.every((teilnahme) => teilnahme.geantwortet));
  assert.deepEqual(
    (
      await AbstimmungErinnerungEndpoint(
        request('POST', `intern/pflege/abstimmungen/${id}/erinnerung`, {
          body: { action: 'preview' },
          login: ANNA,
          id,
        }),
        context(t)
      )
    ).jsonBody,
    { personen: 0 }
  );
});

dbTest('a leader whose address a child shares is not invited after answering', async (t) => {
  offline(t);
  t.mock.method(abstimmungQuellen, 'members', async () => [
    ...MEMBERS,
    // Same address, but neither in a group nor with the label: not offered for invitations
    {
      id: 'per_kim',
      name: { first_name: 'Kim', last_name: 'Bau' },
      primary_email: 'ben.privat@example.test',
      group_names: ['Wölflinge'],
    },
  ]);
  t.mock.method(abstimmungQuellen, 'personen', async () => []);
  t.mock.method(personen, 'eigeneAdresse', async (login: string) =>
    login === BEN
      ? { email: 'ben.privat@example.test', geteilt: true }
      : { email: '', geteilt: false }
  );
  const sent: string[] = [];
  t.mock.method(abstimmungMail, 'send', async (to: string) => {
    sent.push(to);
  });
  const id = await create(t);
  const [first] = (await detail(t, id)).optionen.map((option) => option.id);
  assert.equal((await vote(t, id, BEN, [first])).status, 204);
  const post = (path: 'einladung' | 'erinnerung' | 'mails', body: unknown) =>
    ({
      einladung: AbstimmungEinladungEndpoint,
      erinnerung: AbstimmungErinnerungEndpoint,
      mails: AbstimmungMailsEndpoint,
    })[path](
      request('POST', `intern/pflege/abstimmungen/${id}/${path}`, { body, login: ANNA, id }),
      context(t)
    );
  const { version, eingeladen } = (await post('einladung', { action: 'preview' })).jsonBody as {
    version: string;
    eingeladen: string[];
  };
  // The dialog counts Ben as answered, like the send does
  assert.ok(eingeladen.includes('ben.privat@example.test'));
  const queued = await post('einladung', { action: 'send', version, excluded: [ANNA] });
  assert.equal((queued.jsonBody as { neu: number }).neu, 1);
  await post('mails', {});
  assert.deepEqual(sent, ['erika@example.test']);
  assert.deepEqual((await post('erinnerung', { action: 'preview' })).jsonBody, { personen: 1 });
});

dbTest('only the organizer sees who chose what when the answers are not open', async (t) => {
  offline(t);
  const id = await create(t, { ...FORM, sichtbarkeit: 'anonym' });
  const [fr11, sa12] = (await detail(t, id)).optionen.map((option) => option.id);
  assert.equal((await vote(t, id, BEN, [sa12])).status, 204);
  assert.equal((await vote(t, id, ANNA, [fr11])).status, 204);

  // Ben sees who answered, but not who chose what; with two answers not even the counts,
  // which would show Anna's choice. His own answer stays his
  const ben = await detail(t, id, BEN);
  assert.equal(ben.einsicht, 'namen');
  assert.deepEqual(ben.antworten, [
    { name: 'Ben Bau', gewaehlt: [], vielleicht: [] },
    { name: 'Anna Alt', gewaehlt: [], vielleicht: [] },
  ]);
  assert.equal(ben.zahlenVerborgen, true);
  assert.deepEqual(
    ben.optionen.map((option) => option.stimmen),
    [0, 0, 0]
  );
  assert.deepEqual(ben.ich?.gewaehlt, [sa12]);
  // Anna created it and sees everything
  const anna = await detail(t, id);
  assert.equal(anna.einsicht, 'alles');
  assert.deepEqual(
    anna.antworten.map((antwort) => [antwort.name, antwort.gewaehlt]),
    [
      ['Ben Bau', [sa12]],
      ['Anna Alt', [fr11]],
    ]
  );
  // Over the shared link, also when Anna opens it
  const shared = (
    await AbstimmungAnsehen(
      request('POST', 'abstimmungen/ansehen', { body: { link: linkToken(anna.link) } }),
      context(t)
    )
  ).jsonBody as AbstimmungAnsicht;
  assert.equal(shared.einsicht, 'namen');
  assert.ok(shared.antworten.every((antwort) => antwort.gewaehlt.length === 0));
  // From the third answer on, everyone sees the votes per option
  const oma = await AbstimmungAbstimmen(
    request('PUT', 'abstimmungen/stimme', {
      body: { link: linkToken(anna.link), name: 'Oma Erna', gewaehlt: [sa12] },
    }),
    context(t)
  );
  assert.equal(oma.status, 200);
  const drei = await detail(t, id, BEN);
  assert.equal(drei.zahlenVerborgen, false);
  assert.deepEqual(
    drei.optionen.map((option) => option.stimmen),
    [1, 2, 0]
  );

  // Secret: not even who answered, only how many
  assert.equal((await einstellen(t, id, { sichtbarkeit: 'geheim' })).status, 204);
  const geheim = await detail(t, id, BEN);
  assert.equal(geheim.einsicht, 'anzahl');
  assert.deepEqual(geheim.antworten, []);
  assert.equal(geheim.anzahlAntworten, 3);
  assert.equal((await detail(t, id)).antworten.length, 3);

  // Who answered relied on it: the answers never become more visible
  for (const sichtbarkeit of ['anonym', 'offen']) {
    const looser = await einstellen(t, id, { sichtbarkeit });
    assert.equal(looser.status, 400);
    assert.match(
      (looser.jsonBody as { fields: { sichtbarkeit: string } }).fields.sichtbarkeit,
      /schon Leute abgestimmt/
    );
  }
  // Without answers the setting is free
  const leer = await create(t, { ...FORM, sichtbarkeit: 'geheim' });
  assert.equal((await einstellen(t, leer, { sichtbarkeit: 'offen' })).status, 204);
});

dbTest('a limit counts „Ja“, and „Vielleicht“ only where allowed', async (t) => {
  offline(t);
  const id = await create(t, { ...FORM, maxAuswahl: 2, vielleichtErlaubt: true });
  const [fr11, sa12, fr18] = (await detail(t, id)).optionen.map((option) => option.id);
  const tooMany = await vote(t, id, BEN, [fr11, sa12, fr18]);
  assert.equal(tooMany.status, 400);
  assert.match(
    (tooMany.jsonBody as { fields: { gewaehlt: string } }).fields.gewaehlt,
    /höchstens 2 Optionen/
  );
  assert.equal((await vote(t, id, BEN, [fr11, sa12], [fr18])).status, 204);
  let view = await detail(t, id, BEN);
  assert.deepEqual(view.ich?.vielleicht, [fr18]);
  assert.deepEqual(
    view.optionen.map((option) => [option.stimmen, option.vielleicht]),
    [
      [1, 0],
      [1, 0],
      [0, 1],
    ]
  );
  assert.deepEqual(view.antworten, [
    { name: 'Ben Bau', gewaehlt: [fr11, sa12], vielleicht: [fr18] },
  ]);

  // Over a personal link, too
  const link = linkToken((await detail(t, id)).link);
  const saved = await AbstimmungAbstimmen(
    request('PUT', 'abstimmungen/stimme', {
      body: { link, name: 'Oma Erna', gewaehlt: [fr18], vielleicht: [fr11, sa12] },
    }),
    context(t)
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.jsonBody));
  const { token } = saved.jsonBody as { token: string };
  const own = (
    await AbstimmungAnsehen(
      request('POST', 'abstimmungen/ansehen', { body: { token } }),
      context(t)
    )
  ).jsonBody as AbstimmungAnsicht;
  assert.deepEqual(own.ich, {
    name: 'Oma Erna',
    gewaehlt: [fr18],
    vielleicht: [fr11, sa12],
    geantwortet: true,
  });

  // The rules cannot change under the answers given
  const lower = await einstellen(t, id, { maxAuswahl: 1 });
  assert.equal(lower.status, 400);
  assert.ok('maxAuswahl' in (lower.jsonBody as { fields: object }).fields);
  const ohne = await einstellen(t, id, { vielleichtErlaubt: false });
  assert.equal(ohne.status, 400);
  assert.ok('vielleichtErlaubt' in (ohne.jsonBody as { fields: object }).fields);
  assert.equal((await einstellen(t, id, { maxAuswahl: null })).status, 204);
  view = await detail(t, id);
  assert.equal(view.maxAuswahl, null);

  // Where „Vielleicht“ is not allowed, it is refused
  const streng = await create(t);
  const [erste, zweite] = (await detail(t, streng)).optionen.map((option) => option.id);
  const refused = await vote(t, streng, BEN, [erste], [zweite]);
  assert.equal(refused.status, 400);
  assert.equal((await detail(t, streng)).ich, null);
});

dbTest('inviting more people than fit says how many fit', async (t) => {
  offline(t);
  t.mock.method(abstimmungQuellen, 'members', async () => MEMBERS.slice(2));
  t.mock.method(abstimmungQuellen, 'personen', async () => []);
  const id = await create(t);
  // Guests who came over the shared link, one short of the limit
  await getDb()
    .insertInto('abstimmung.teilnahme')
    .values(
      Array.from({ length: 299 }, (_, index) => ({
        abstimmung_id: id,
        token: `gast${index}`.padEnd(43, 'x'),
        name: `Gast ${index}`,
      }))
    )
    .execute();
  const post = (body: unknown) =>
    AbstimmungEinladungEndpoint(
      request('POST', `intern/pflege/abstimmungen/${id}/einladung`, { body, login: ANNA, id }),
      context(t)
    );
  const { version } = (await post({ action: 'preview' })).jsonBody as { version: string };
  const refused = await post({ action: 'send', version, extra: ['neu@example.test'] });
  assert.equal(refused.status, 400);
  assert.match(
    (refused.jsonBody as { fields: { form: string } }).fields.form,
    /höchstens 300 Personen mitmachen\. Es sind schon 299, dazu kämen 2 neue\. Wähle weniger Personen aus\./
  );
});

dbTest(
  'an answer under a stricter setting is never shown with the setting read before',
  async (t) => {
    offline(t);
    const id = await create(t);
    const [first] = (await detail(t, id)).optionen.map((option) => option.id);
    assert.equal((await vote(t, id, ANNA, [first])).status, 204);
    const { etag } = await detail(t, id);
    const view = (await detail(t, id)).optionen.map(({ id: optionId, text }) => ({
      id: optionId,
      text,
    }));
    // Ben's view reads the setting „offen“; meanwhile it becomes „geheim“ and Ben answers
    let einmal = true;
    t.mock.method(lesen, 'nachKopf', async () => {
      if (!einmal) return;
      einmal = false;
      const tighter = await AbstimmungItemEndpoint(
        request('PATCH', `intern/pflege/abstimmungen/${id}`, {
          body: { ...FORM, sichtbarkeit: 'geheim', etag, optionen: view },
          login: ANNA,
          id,
        }),
        context(t)
      );
      assert.equal(tighter.status, 204, JSON.stringify(tighter.jsonBody));
      assert.equal((await vote(t, id, BEN, [first])).status, 204);
    });
    const ben = await detail(t, id, BEN);
    assert.equal(ben.einsicht, 'anzahl');
    assert.deepEqual(ben.antworten, []);
    assert.equal(ben.anzahlAntworten, 2);
  }
);
