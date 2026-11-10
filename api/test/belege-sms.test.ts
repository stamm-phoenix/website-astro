import assert from 'node:assert/strict';
import { CONFIG } from '../lib/config';
import { mobileNumbersOf } from '../lib/beleg-sms';
import * as mail from '../lib/mail';
import { createPerson } from '../lib/personen';
import * as sms from '../lib/sms';
import * as taskDirectory from '../lib/task-directory';
import { BelegeCollection } from '../endpoints/intern-pflege-belege';
import { overrideConfig } from './fixtures/config';
import { dbTest } from './fixtures/database';
import { INPUT, jpeg, PRINCIPAL, request, setup, STAFF_ROLES } from './fixtures/belege';
import type { TestContext } from 'node:test';

/** CampFlow persons by ID, answered from memory; others are not found. */
function campflowPersons(t: TestContext, persons: Record<string, unknown>): string[] {
  const token = process.env.CAMPFLOW_API_TOKEN;
  process.env.CAMPFLOW_API_TOKEN = 'test-token';
  t.after(() => {
    if (token === undefined) delete process.env.CAMPFLOW_API_TOKEN;
    else process.env.CAMPFLOW_API_TOKEN = token;
  });
  const asked: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const id = decodeURIComponent(String(input).split('/').pop() ?? '').split('?')[0] ?? '';
    asked.push(id);
    const person = persons[id];
    return person
      ? Response.json({ data: { id, ...(person as object) } })
      : new Response('', { status: 404 });
  });
  return asked;
}

async function link(login: string, campflowPersonId: string): Promise<void> {
  await createPerson(
    { name: login, login, gruppe: 'leitende', campflowPersonId, aktiv: true },
    'test@example.test'
  );
}

dbTest('the mobile numbers come from the CampFlow persons linked to the logins', async (t) => {
  await link('kasse.eins@stamm-phoenix.de', 'per_eins');
  await link('kasse.zwei@stamm-phoenix.de', 'per_zwei');
  await link('kasse.drei@stamm-phoenix.de', 'per_drei');
  await link('kasse.vier@stamm-phoenix.de', 'per_fehlt');
  await link('andere@stamm-phoenix.de', 'per_andere');
  const asked = campflowPersons(t, {
    per_eins: { phone_numbers: [{ number: '0176 1234567' }] },
    // The same number twice gets one SMS
    per_zwei: { phone_numbers: [{ number: '08063 12345' }, { number: '+49 176 1234567' }] },
    per_drei: { phone_numbers: [{ number: '08063 12345' }] },
    per_andere: { phone_numbers: [{ number: '0160 1111111' }] },
  });

  const numbers = await mobileNumbersOf([
    'Kasse.Eins@stamm-phoenix.de',
    'kasse.zwei@stamm-phoenix.de',
    'kasse.drei@stamm-phoenix.de',
    'kasse.vier@stamm-phoenix.de',
    'unverknuepft@stamm-phoenix.de',
  ]);

  assert.deepEqual(numbers, ['+491761234567']);
  assert.deepEqual(asked.sort(), ['per_drei', 'per_eins', 'per_fehlt', 'per_zwei']);
  assert.deepEqual(await mobileNumbersOf([]), []);
});

dbTest('submitting a receipt sends the Kasse an SMS, also without mails', async (t) => {
  const { context } = setup(t);
  t.mock.method(context, 'warn', () => undefined);
  const uploader = { ...PRINCIPAL, userDetails: 'leitung@example.test', userRoles: STAFF_ROLES };
  t.mock.method(taskDirectory, 'readTaskDirectory', async () =>
    ['kasse.eins@stamm-phoenix.de', 'leitung@example.test'].map((login) => ({
      name: login,
      givenName: login,
      login,
    }))
  );
  t.mock.method(taskDirectory, 'getTaskDirectoryUsers', async () => [
    { name: 'Lea Leitung', givenName: 'Lea', login: 'leitung@example.test' },
  ]);
  await link('kasse.eins@stamm-phoenix.de', 'per_eins');
  await link('leitung@example.test', 'per_leitung');
  campflowPersons(t, {
    per_eins: { phone_numbers: [{ number: '0176 1234567' }] },
    per_leitung: { phone_numbers: [{ number: '0160 1111111' }] },
  });
  overrideConfig(t, CONFIG.mail, { belegeSender: undefined });
  overrideConfig(t, CONFIG, { sms: { endpoint: 'https://acs.example.test', sender: 'Test' } });
  const send = t.mock.method(sms, 'sendSms', async () => []);
  const sendMail = t.mock.method(mail, 'sendMail', async () => undefined);
  const photo = Buffer.from(jpeg(1200, 1600)).toString('base64');

  const response = await BelegeCollection(
    request('POST', { ...INPUT, photo }, { principal: uploader }),
    context
  );

  assert.equal(response.status, 201);
  assert.equal(sendMail.mock.callCount(), 0);
  assert.equal(send.mock.callCount(), 1);
  const [numbers, message, timeoutMs] = send.mock.calls[0]?.arguments ?? [];
  // Not the uploader, even though they are in the Kasse and have a number
  assert.deepEqual(numbers, ['+491761234567']);
  assert.equal(
    message,
    'Neuer Beleg zur Prüfung: REWE, 12,34 € von Lea Leitung. http://localhost/leitendenbereich/belege'
  );
  assert.ok(typeof timeoutMs === 'number' && timeoutMs > 0 && timeoutMs <= 10_000);

  // A failing SMS never blocks submitting
  send.mock.mockImplementation(async () => {
    throw new Error('acs');
  });
  const failing = await BelegeCollection(
    request('POST', { ...INPUT, photo }, { principal: uploader }),
    context
  );
  assert.equal(failing.status, 201);
});
