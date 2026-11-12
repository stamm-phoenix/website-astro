import assert from 'node:assert/strict';
import test from 'node:test';
import * as campflow from '../lib/campflow';
import * as mail from '../lib/mail';
import * as personen from '../lib/personen';
import { leitendenAdresse, leitendenEmpfaenger, sendLeitendenMail } from '../lib/leitenden-mail';

const LOGIN = 'lea.leitung@stamm-phoenix.de';

test('the CampFlow address joins the login once, ignoring case', () => {
  assert.deepEqual(leitendenEmpfaenger(LOGIN, ''), [LOGIN]);
  assert.deepEqual(leitendenEmpfaenger(LOGIN, 'LEA.Leitung@stamm-phoenix.de'), [LOGIN]);
  assert.deepEqual(leitendenEmpfaenger(LOGIN, 'lea@example.org'), [LOGIN, 'lea@example.org']);
});

test('a note goes in one mail to the login and the CampFlow address, with the options', async (t) => {
  t.mock.method(leitendenAdresse, 'campflow', async () => 'lea@example.org');
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  await sendLeitendenMail(LOGIN, 'Betreff', '<p>Text</p>', {
    sender: 'kontakt@stamm-phoenix.de',
    retry: false,
    timeoutMs: 10_000,
    saveToSentItems: false,
  });
  assert.equal(send.mock.callCount(), 1);
  const [to, subject, html, sender, replyTo, options] = send.mock.calls[0].arguments;
  assert.deepEqual(to, [LOGIN, 'lea@example.org']);
  assert.equal(subject, 'Betreff');
  assert.equal(html, '<p>Text</p>');
  assert.equal(sender, 'kontakt@stamm-phoenix.de');
  assert.equal(replyTo, undefined);
  assert.equal(options?.retry, false);
  assert.equal(options?.saveToSentItems, false);
  assert.ok(options?.timeoutMs !== undefined && options.timeoutMs > 0);
  assert.ok(options.timeoutMs <= 10_000);
});

test('without a link or when the lookup fails, the note still goes to the login', async (t) => {
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  const lookup = t.mock.method(leitendenAdresse, 'campflow', async () => '');
  await sendLeitendenMail(LOGIN, 'A', '<p>A</p>');
  lookup.mock.mockImplementation(async () => {
    throw new campflow.CampflowError(503, 'down');
  });
  await sendLeitendenMail(LOGIN, 'B', '<p>B</p>');
  assert.deepEqual(
    send.mock.calls.map((call) => call.arguments[0]),
    [LOGIN, LOGIN]
  );
});

test('a slow lookup takes at most a third of the timeout, the rest is left for sending', async (t) => {
  t.mock.method(leitendenAdresse, 'campflow', () => new Promise<string>(() => undefined));
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  const start = Date.now();
  await sendLeitendenMail(LOGIN, 'Betreff', '<p>Text</p>', { timeoutMs: 300 });
  assert.ok(Date.now() - start < 250);
  const [to, , , , , options] = send.mock.calls[0].arguments;
  assert.equal(to, LOGIN);
  assert.ok(options?.timeoutMs !== undefined && options.timeoutMs > 100);
  assert.ok(options.timeoutMs < 300);
});

test('the address of the linked person counts only if it is valid and no other member uses it', async (t) => {
  const linked = t.mock.method(personen, 'getCampflowPersonId', async (login: string) =>
    login === LOGIN ? 'per_Lea' : undefined
  );
  let person: campflow.CampflowPerson = { id: 'per_Lea', primary_email: ' Lea@Example.org ' };
  let members: campflow.CampflowPerson[] = [
    person,
    { id: 'per_Max', primary_email: 'max@example.org' },
  ];
  const get = t.mock.method(campflow, 'campflowGet', async (path: string) => {
    assert.equal(path, '/lists/member/persons/per_Lea');
    return person;
  });
  t.mock.method(campflow, 'getCampflowMembers', async () => members);

  assert.equal(await leitendenAdresse.campflow(LOGIN), 'lea@example.org');
  assert.equal(await leitendenAdresse.campflow('max@stamm-phoenix.de'), '');
  assert.equal(linked.mock.callCount(), 2);
  assert.equal(get.mock.callCount(), 1);

  // A family address, e.g. shared with a child, may be read by others
  members = [person, { id: 'per_Kind', primary_email: 'lea@example.org' }];
  assert.equal(await leitendenAdresse.campflow(LOGIN), '');

  person = { id: 'per_Lea', primary_email: 'keine adresse' };
  members = [person];
  assert.equal(await leitendenAdresse.campflow(LOGIN), '');
});
