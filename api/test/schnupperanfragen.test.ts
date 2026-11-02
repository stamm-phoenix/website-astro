import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { sql } from 'kysely';
import {
  SchnupperAnfrageAbsagenEndpoint,
  SchnupperAnfrageBestaetigenEndpoint,
  SchnupperAnfrageItemEndpoint,
  SchnupperAnfragenCollectionEndpoint,
} from '../endpoints/intern-pflege-schnupperanfragen';
import { SchnupperAnfrageSendEndpoint } from '../endpoints/schnupperanfrage';
import { CONFIG } from '../lib/config';
import { getDb } from '../lib/db';
import * as mail from '../lib/mail';
import type { SchnupperAntwortErgebnis, StaffSchnupperAnfrage } from '../lib/schnupper-model';
import {
  cancelSchnupperAnfrage,
  confirmSchnupperAnfrage,
  markSchnupperMail,
} from '../lib/schnupperanfragen';
import { solvedAltcha, useAltcha } from './fixtures/altcha';
import { overrideConfig } from './fixtures/config';
import { dbTest } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'leiterin@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};

const ANFRAGE = {
  alter: 8,
  kindVorname: 'Mia',
  name: 'Erika Muster',
  email: 'erika@example.test',
  telefon: '0170 1234567',
  wunschzeit: 'Nach den Herbstferien',
  nachricht: '',
};

/** A date far enough ahead that the check „not in the past“ never fails. */
const DATUM = '2099-03-10';

interface SentMail {
  to: string;
  subject: string;
  html: string;
  replyTo?: mail.MailReplyTo;
}

/** Simulates the mail delivery; `failing` lets mails to the family fail. */
function setup(t: TestContext, failing = false): { context: InvocationContext; sent: SentMail[] } {
  useAltcha(t);
  const sent: SentMail[] = [];
  t.mock.method(
    mail,
    'sendMail',
    async (
      to: string,
      subject: string,
      html: string,
      _sender?: string,
      replyTo?: mail.MailReplyTo
    ) => {
      if (failing && to !== CONFIG.kontakt.mailbox) throw new Error('Graph down');
      sent.push({ to, subject, html, replyTo });
    }
  );
  const context = new InvocationContext({ functionName: 'schnupper-test' });
  for (const level of ['log', 'warn', 'error'] as const)
    t.mock.method(context, level, () => undefined);
  return { context, sent };
}

function request(
  method: string,
  body?: unknown,
  options: { id?: number; principal?: unknown; headers?: Record<string, string> } = {}
): HttpRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...options.headers,
  };
  if (options.principal !== null) {
    headers['x-ms-client-principal'] = Buffer.from(
      JSON.stringify(options.principal ?? PRINCIPAL)
    ).toString('base64');
  }
  return new HttpRequest({
    url: 'http://localhost/api/schnupperanfrage',
    method,
    headers,
    params: options.id === undefined ? {} : { id: String(options.id) },
    body: body === undefined || method === 'GET' ? undefined : { string: JSON.stringify(body) },
  });
}

async function clear(): Promise<void> {
  await getDb().deleteFrom('organisation.schnupper_anfrage').execute();
}

async function submit(context: InvocationContext, extra: object = {}) {
  return SchnupperAnfrageSendEndpoint(
    request('POST', { ...ANFRAGE, altcha: await solvedAltcha(), ...extra }, { principal: null }),
    context
  );
}

async function list(context: InvocationContext): Promise<StaffSchnupperAnfrage[]> {
  const response = await SchnupperAnfragenCollectionEndpoint(request('GET'), context);
  assert.equal(response.status, 200);
  return response.jsonBody as StaffSchnupperAnfrage[];
}

async function only(context: InvocationContext): Promise<StaffSchnupperAnfrage> {
  const items = await list(context);
  assert.equal(items.length, 1);
  return items[0];
}

const bestaetigen = (context: InvocationContext, item: StaffSchnupperAnfrage, extra = {}) =>
  SchnupperAnfrageBestaetigenEndpoint(
    request(
      'POST',
      {
        stufe: 'jupfis',
        datum: DATUM,
        zeit: '17:30',
        ort: 'Pfarrheim',
        antwort: '',
        etag: item.etag,
        ...extra,
      },
      { id: item.id }
    ),
    context
  );

dbTest('a request is stored, the Stamm is told and the family gets a receipt', async (t) => {
  await clear();
  const { context, sent } = setup(t);
  const response = await submit(context);
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { status: 'sent', receipt: true });

  const item = await only(context);
  assert.equal(item.status, 'offen');
  assert.equal(item.stufe, 'woelflinge');
  assert.equal(item.alter, 8);
  assert.equal(item.kindVorname, 'Mia');
  assert.equal(item.termin, null);

  assert.deepEqual(
    sent.map((m) => m.to),
    [CONFIG.kontakt.mailbox, 'erika@example.test']
  );
  assert.equal(sent[0].replyTo?.address, 'erika@example.test');
  assert.match(sent[0].subject, /Schnupperanfrage: 8 Jahre – Erika Muster/);
  assert.match(sent[0].html, /\/leitendenbereich\/schnupperanfragen/);
  assert.match(sent[1].html, /Stand: offen/);
});

dbTest('a honeypot or invalid input stores nothing', async (t) => {
  await clear();
  const { context, sent } = setup(t);
  assert.equal((await submit(context, { website: 'http://spam.test' })).status, 200);
  const invalid = await submit(context, { alter: 2, email: 'kaputt' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(Object.keys((invalid.jsonBody as { fields: object }).fields).sort(), [
    'alter',
    'email',
  ]);
  assert.equal((await list(context)).length, 0);
  assert.equal(sent.length, 0);
});

dbTest('a failed receipt keeps the request and says so', async (t) => {
  await clear();
  const { context } = setup(t, true);
  const response = await submit(context);
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { status: 'sent', receipt: false });
  assert.equal((await list(context)).length, 1);
});

dbTest('too many requests at once are refused', async (t) => {
  await clear();
  const { context } = setup(t);
  overrideConfig(t, CONFIG.schnupper, { hourlyLimit: 1 });
  assert.equal((await submit(context)).status, 200);
  assert.equal((await submit(context)).status, 429);
});

dbTest('confirming a date needs the loaded version and mails the date', async (t) => {
  await clear();
  const { context, sent } = setup(t);
  await submit(context);
  const item = await only(context);

  const response = await bestaetigen(context, item, { antwort: 'Feste Schuhe anziehen.' });
  assert.equal(response.status, 200);
  const result = response.jsonBody as SchnupperAntwortErgebnis;
  assert.equal(result.mailSent, true);
  assert.equal(result.anfrage.status, 'bestaetigt');
  // The leaders chose another Stufe than the one of the age
  assert.equal(result.anfrage.stufe, 'jupfis');
  assert.deepEqual(result.anfrage.termin, { datum: DATUM, zeit: '17:30', ort: 'Pfarrheim' });
  assert.equal(result.anfrage.bearbeitetVon, 'leiterin@example.test');

  const answer = sent.at(-1);
  assert.equal(answer?.to, 'erika@example.test');
  assert.match(answer?.subject ?? '', /Schnupperstunde am Dienstag, 10\. März 2099 bestätigt/);
  assert.match(answer?.html ?? '', /17:30 Uhr/);
  assert.match(answer?.html ?? '', /Feste Schuhe anziehen\./);

  // The old version is stale now
  assert.equal((await bestaetigen(context, item)).status, 409);
  assert.equal((await only(context)).antwortMail, true);
});

dbTest('a failed answer mail keeps the answer and is shown to the leader', async (t) => {
  await clear();
  const { context } = setup(t);
  await submit(context);
  const item = await only(context);
  t.mock.restoreAll();
  const failing = setup(t, true);
  const result = (await bestaetigen(failing.context, item)).jsonBody as SchnupperAntwortErgebnis;
  assert.equal(result.mailSent, false);
  const stored = await only(failing.context);
  assert.equal(stored.status, 'bestaetigt');
  assert.equal(stored.antwortMail, false);
});

dbTest('cancelling a confirmed request removes the date and tells the family', async (t) => {
  await clear();
  const { context, sent } = setup(t);
  await submit(context);
  const confirmed = (
    (await bestaetigen(context, await only(context))).jsonBody as SchnupperAntwortErgebnis
  ).anfrage;
  const response = await SchnupperAnfrageAbsagenEndpoint(
    request(
      'POST',
      { antwort: 'Die Gruppe ist voll.', etag: confirmed.etag },
      { id: confirmed.id }
    ),
    context
  );
  assert.equal(response.status, 200);
  const { anfrage } = response.jsonBody as SchnupperAntwortErgebnis;
  assert.equal(anfrage.status, 'abgesagt');
  assert.equal(anfrage.termin, null);
  assert.match(sent.at(-1)?.html ?? '', /Stand: abgesagt/);
  assert.match(sent.at(-1)?.html ?? '', /Die Gruppe ist voll\./);
});

dbTest('deleting needs the loaded version; non-leaders get nothing', async (t) => {
  await clear();
  const { context } = setup(t);
  await submit(context);
  const item = await only(context);

  for (const principal of [null, { ...PRINCIPAL, userRoles: ['authenticated'] }]) {
    for (const [endpoint, method] of [
      [SchnupperAnfragenCollectionEndpoint, 'GET'],
      [SchnupperAnfrageItemEndpoint, 'DELETE'],
      [SchnupperAnfrageBestaetigenEndpoint, 'POST'],
      [SchnupperAnfrageAbsagenEndpoint, 'POST'],
    ] as const) {
      const response = await endpoint(request(method, {}, { id: item.id, principal }), context);
      assert.ok([401, 403].includes(response.status ?? 0), `${method} ${response.status}`);
    }
  }

  const stale = await SchnupperAnfrageItemEndpoint(
    request('DELETE', undefined, { id: item.id, headers: { 'if-match': '"0000000000000001"' } }),
    context
  );
  assert.equal(stale.status, 409);
  const deleted = await SchnupperAnfrageItemEndpoint(
    request('DELETE', undefined, { id: item.id, headers: { 'if-match': item.etag } }),
    context
  );
  assert.equal(deleted.status, 204);
  assert.equal((await list(context)).length, 0);
});

dbTest('opening the module deletes requests past their retention', async (t) => {
  await clear();
  const { context } = setup(t);
  await submit(context);
  await submit(context, { name: 'Frisch Muster' });
  const [neu, alt] = await list(context);
  assert.equal(neu.name, 'Frisch Muster');
  await getDb()
    .updateTable('organisation.schnupper_anfrage')
    .set({ created_at: sql<Date>`DATEADD(day, -181, SYSUTCDATETIME())` })
    .where('id', '=', alt.id)
    .execute();
  assert.deepEqual(
    (await list(context)).map((item) => item.name),
    ['Frisch Muster']
  );
});

dbTest('the mail of an outdated answer never changes the flag of a newer one', async (t) => {
  await clear();
  const { context } = setup(t);
  await submit(context);
  const offen = await only(context);
  const bestaetigt = await confirmSchnupperAnfrage(
    offen.id,
    { stufe: 'woelflinge', datum: DATUM, zeit: '17:30', ort: '', antwort: '' },
    offen.etag,
    'anna@example.test'
  );
  // Another leader cancels while the confirmation mail is still on its way
  const abgesagt = await cancelSchnupperAnfrage(
    offen.id,
    { antwort: '' },
    bestaetigt.etag,
    'ben@example.test'
  );
  const neu = await markSchnupperMail(offen.id, abgesagt.etag, false);
  assert.equal(neu?.antwortMail, false);
  const spaet = await markSchnupperMail(offen.id, bestaetigt.etag, true);
  assert.equal(spaet?.status, 'abgesagt');
  assert.equal(spaet?.antwortMail, false);
  assert.equal((await only(context)).antwortMail, false);
});
