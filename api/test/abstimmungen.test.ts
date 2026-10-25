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
import {
  abstimmungErgebnis,
  validateAbstimmung,
  validateAbstimmungName,
  validateGewaehlt,
} from '../lib/abstimmung-model';
import type { AbstimmungAnsicht, AbstimmungDetail } from '../lib/abstimmung-model';
import { abstimmungMail, abstimmungMailContent } from '../lib/abstimmung-mails';
import type { AbstimmungMailDaten } from '../lib/abstimmung-mails';
import { getDb } from '../lib/db';
import { ValidationError } from '../lib/pflege-validation';
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
  t.mock.method(personen, 'eigeneAdresse', async () => '');
  t.mock.method(personen, 'mitEigenerAdresse', async (_login: string, list: unknown[]) => list);
  t.mock.method(taskDirectory, 'getTaskDirectoryUsers', async () => [
    { name: 'Anna Alt', login: ANNA, givenName: 'Anna' },
    { name: 'Ben Bau', login: BEN, givenName: 'Ben' },
  ]);
}

const FORM = {
  titel: 'Termin Weihnachtsfeier',
  beschreibung: 'Bitte alle passenden Termine wählen.',
  mehrfach: true,
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
  gewaehlt: number[]
): Promise<HttpResponseInit> {
  return AbstimmungStimmeEndpoint(
    request('PUT', `intern/pflege/abstimmungen/${id}/stimme`, { body: { gewaehlt }, login, id }),
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
  assert.equal(input.mehrfach, true);
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

test('validateGewaehlt keeps the order of the options and honors a single choice', () => {
  assert.deepEqual(validateGewaehlt([3, 1], [1, 2, 3], true), [1, 3]);
  assert.deepEqual(validateGewaehlt([], [1, 2], false), []);
  const field = (pattern: RegExp) => (error: unknown) =>
    error instanceof ValidationError && pattern.test(error.fields.gewaehlt);
  assert.throws(() => validateGewaehlt([1, 2], [1, 2], false), field(/nur eine/));
  assert.throws(() => validateGewaehlt([9], [1, 2], true), field(/gibt es nicht mehr/));
  assert.throws(() => validateGewaehlt('1', [1, 2], true), ValidationError);
});

test('abstimmungErgebnis counts the votes per option', () => {
  const ergebnis = abstimmungErgebnis({
    id: 1,
    titel: 'T',
    beschreibung: '',
    mehrfach: true,
    geschlossen: false,
    erstelltVonName: 'Anna',
    optionen: [
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ],
    antworten: [
      { teilnahmeId: 5, name: 'Lea', gewaehlt: [1, 2] },
      { teilnahmeId: 6, name: 'Max', gewaehlt: [2] },
      { teilnahmeId: 7, name: 'Kim', gewaehlt: [] },
    ],
  });
  assert.deepEqual(
    ergebnis.optionen.map((option) => option.stimmen),
    [1, 2]
  );
  assert.deepEqual(ergebnis.antworten[2], { name: 'Kim', gewaehlt: [] });
});

test('the mail escapes the text and carries the personal link', () => {
  const data: AbstimmungMailDaten = {
    art: 'einladung',
    name: 'Lea Muster',
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
  assert.deepEqual(ben.ich, { name: 'Ben Bau', gewaehlt: [fr18], geantwortet: true });
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
  assert.deepEqual(ownView.ich, { name: 'Oma Erna', gewaehlt: [sa12, fr18], geantwortet: true });
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

  // Turning off several choices is refused while people chose several
  const single = await AbstimmungItemEndpoint(
    request('PATCH', `intern/pflege/abstimmungen/${id}`, {
      body: {
        ...FORM,
        etag: view.etag,
        mehrfach: false,
        optionen: view.optionen.map(({ id: optionId, text }) => ({ id: optionId, text })),
      },
      login: ANNA,
      id,
    }),
    context(t)
  );
  assert.equal(single.status, 400);

  // Removing an option removes its votes; a new one starts without
  const edited = await AbstimmungItemEndpoint(
    request('PATCH', `intern/pflege/abstimmungen/${id}`, {
      body: {
        ...FORM,
        etag: view.etag,
        optionen: [
          { id: fr18, text: 'Fr, 18.12. ab 19 Uhr' },
          { id: sa12, text: 'Sa, 12.12.' },
          { text: 'So, 13.12.' },
        ],
      },
      login: ANNA,
      id,
    }),
    context(t)
  );
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
    login === BEN ? 'ben.privat@example.test' : ''
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
