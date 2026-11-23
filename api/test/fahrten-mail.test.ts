import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampflowEvent, CampflowPerson } from '../lib/campflow';
import { fahrtenMails } from '../lib/fahrten-mail';
import { ValidationError } from '../lib/validation/errors';

const EVENT: CampflowEvent = {
  id: 'evt_Lager',
  title: 'Pfingstlager',
  published: true,
  start_date: '2026-05-23',
  end_date: '2026-05-25',
  max_persons: null,
  archived: false,
  url: null,
  collection: null,
};

function person(id: string, first: string, last: string, extra: object = {}): CampflowPerson {
  return { id, name: { first_name: first, last_name: last }, ...extra };
}

const PERSONS = [
  person('per_fahrer', 'Lena', 'Huber', {
    primary_email: 'huber@example.org',
    cc_emails: ['papa.huber@example.org', 'HUBER@example.org'],
  }),
  person('per_kind', 'Tom', 'Maier', { phone_numbers: [{ number: '0176 123', label: 'Mama' }] }),
  person('per_ohne', 'Ida', 'Berg'),
  person('per_weg', 'Max', 'Weg', { cancellation_date: '2026-05-01' }),
];

test('each driver gets one mail with the passengers of both directions', () => {
  const { mails, ohneAdresse } = fahrtenMails(
    EVENT,
    PERSONS,
    {
      fahrten: {
        hin: [
          { fahrer: 'per_fahrer', mitfahrende: ['per_kind'] },
          { fahrer: 'per_ohne', mitfahrende: [] },
        ],
        rueck: [],
      },
      nachricht: 'Treffpunkt <9 Uhr>\nam Pfarrheim',
    },
    'Hugo'
  );

  assert.deepEqual(ohneAdresse, ['Ida Berg']);
  assert.equal(mails.length, 1);
  const [mail] = mails;
  assert.deepEqual(mail.to, ['huber@example.org', 'papa.huber@example.org']);
  assert.equal(mail.subject, 'Fahrt zu „Pfingstlager“: Auto von Lena Huber');
  assert.match(mail.html, /23\.05\.2026 – 25\.05\.2026/);
  assert.match(mail.html, /Tom Maier · 0176 123 \(Mama\)/);
  assert.match(mail.html, /Rückfahrt<\/h2><p[^>]*>Du fährst nicht\.<\/p>/);
  // The note is escaped and keeps its line break
  assert.match(mail.html, /Treffpunkt &lt;9 Uhr&gt;<br \/>am Pfarrheim/);
  assert.match(mail.html, /Gut Pfad<br \/>Hugo/);
});

test('a cancelled or unknown registration in the plan is refused', () => {
  for (const id of ['per_weg', 'per_fremd']) {
    assert.throws(
      () =>
        fahrtenMails(
          EVENT,
          PERSONS,
          {
            fahrten: { hin: [{ fahrer: 'per_fahrer', mitfahrende: [id] }], rueck: [] },
            nachricht: '',
          },
          'Hugo'
        ),
      ValidationError
    );
  }
});
