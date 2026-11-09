import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fuerMich,
  kategorieFuer,
  konversationenAus,
  statusAus,
  zustaendigAus,
  type InboxNachricht,
  type MailOrdner,
  type OutlookFlag,
} from '../lib/postfach-model';
import { aenderungen, nachAenderung } from '../lib/postfach-aenderung';
import { POSTFAECHER, postfachRoles, nachrichtOutlookUrl } from '../lib/postfach-liste';
import { CONFIG } from '../lib/config';
import { postfachBenachrichtigung, zuweisungMail, zuweisungenMail } from '../lib/postfach-mails';
import * as token from '../lib/token';
import type { Client } from '@microsoft/microsoft-graph-client';

function nachricht(
  id: string,
  konversation: string,
  am: string,
  betreff = 'Frage',
  flag: OutlookFlag = 'notFlagged',
  kategorien: string[] = [],
  ordner: MailOrdner = 'posteingang'
): InboxNachricht {
  return {
    id,
    konversation,
    betreff,
    von: { name: 'Erika Muster', adresse: 'erika@example.invalid' },
    am,
    vorschau: `Text ${id}`,
    hatAnhang: id === 'm2',
    wichtig: false,
    flag,
    kategorien,
    ordner,
  };
}

const PERSONEN = [
  { login: 'lea@stamm-phoenix.de', name: 'Lea Leitung' },
  { login: 'tom@stamm-phoenix.de', name: 'Tom Test' },
];

test('messages are grouped into conversations with the newest message on top', () => {
  const zeilen = konversationenAus(
    'kontakt',
    [
      nachricht('m1', 'k1', '2026-11-01T08:00:00.000Z', 'Alt', 'complete', [], 'archiv'),
      nachricht('m2', 'k1', '2026-11-03T08:00:00.000Z', 'AW: Alt'),
      nachricht('m3', 'k2', '2026-11-02T08:00:00.000Z', 'Andere', 'notFlagged', [
        'Rechnung',
        '👤 lea leitung',
      ]),
      nachricht('m4', 'k3', '2026-10-30T08:00:00.000Z', 'Fertig', 'notFlagged', [], 'archiv'),
    ],
    PERSONEN
  );
  // A reply after „Erledigt“ is in the inbox: the line shows it and counts only the inbox
  assert.deepEqual(
    zeilen.map((zeile) => [zeile.id, zeile.betreff, zeile.anzahl, zeile.status, zeile.hatAnhang]),
    [
      ['k1', 'AW: Alt', 1, 'neu', true],
      ['k2', 'Andere', 1, 'neu', false],
      ['k3', 'Fertig', 1, 'erledigt', false],
    ]
  );
  assert.deepEqual(zeilen[1].zustaendig, { login: 'lea@stamm-phoenix.de', name: 'Lea Leitung' });
  assert.equal(zeilen[0].zustaendig, null);
});

test('done is archived, a flag in the inbox needs action, the rest is new', () => {
  const mit = (...nachrichten: [OutlookFlag, MailOrdner][]) =>
    statusAus(nachrichten.map(([flag, ordner]) => ({ flag, ordner })));
  assert.equal(mit(['notFlagged', 'archiv']), 'erledigt');
  assert.equal(mit(['flagged', 'archiv'], ['notFlagged', 'anderer']), 'erledigt');
  assert.equal(mit(['flagged', 'archiv'], ['notFlagged', 'posteingang']), 'neu');
  assert.equal(mit(['complete', 'posteingang'], ['flagged', 'posteingang']), 'handlungsbedarf');
  assert.equal(mit(['complete', 'posteingang']), 'neu');
  assert.equal(mit(), 'erledigt');
});

test('a person category names the person, matched without case, unknown names stay names', () => {
  assert.equal(zustaendigAus(['Rechnung'], PERSONEN), null);
  assert.equal(zustaendigAus(['👤 '], PERSONEN), null);
  assert.deepEqual(zustaendigAus(['👤 TOM TEST'], PERSONEN), {
    login: 'tom@stamm-phoenix.de',
    name: 'Tom Test',
  });
  assert.deepEqual(zustaendigAus(['👤 Anton Alt'], PERSONEN), { login: null, name: 'Anton Alt' });
});

test('two people with the same name get categories that tell them apart', () => {
  const zwei = [
    { login: 'lea.a@stamm-phoenix.de', name: 'Lea Leitung' },
    { login: 'lea.b@stamm-phoenix.de', name: 'Lea Leitung' },
    { login: 'tom@stamm-phoenix.de', name: 'Tom Test' },
  ];
  assert.equal(kategorieFuer(zwei[1], zwei), '👤 Lea Leitung (lea.b)');
  assert.equal(kategorieFuer(zwei[2], zwei), '👤 Tom Test');
  assert.deepEqual(zustaendigAus(['👤 Lea Leitung (lea.b)'], zwei), {
    login: 'lea.b@stamm-phoenix.de',
    name: 'Lea Leitung (lea.b)',
  });
  // Without the login the name fits both: it is shown, but belongs to nobody
  assert.deepEqual(zustaendigAus(['👤 Lea Leitung'], zwei), { login: null, name: 'Lea Leitung' });
  // The other Lea left: the category with the login still belongs to the one who stays
  assert.equal(
    zustaendigAus(['👤 Lea Leitung (lea.b)'], [zwei[1], zwei[2]])?.login,
    'lea.b@stamm-phoenix.de'
  );
  assert.equal(
    zustaendigAus(['👤 Lea Leitung'], [zwei[1], zwei[2]])?.login,
    'lea.b@stamm-phoenix.de'
  );
});

test('changes touch only what differs, move between inbox and archive and keep categories', () => {
  const nachrichten = [
    nachricht('a', 'k', '2026-11-01T08:00:00.000Z', 'x', 'flagged', ['Rechnung', '👤 Tom Test']),
    nachricht('b', 'k', '2026-11-02T08:00:00.000Z', 'x', 'notFlagged', ['👤 Tom Test']),
  ];
  assert.deepEqual(aenderungen(nachrichten, { status: 'handlungsbedarf' }), [
    { id: 'a', flag: 'notFlagged' },
    { id: 'b', flag: 'flagged' },
  ]);
  // Done: archived, a flag still open completed
  assert.deepEqual(aenderungen(nachrichten, { status: 'erledigt' }), [
    { id: 'a', flag: 'complete', verschieben: 'archive' },
    { id: 'b', verschieben: 'archive' },
  ]);
  assert.deepEqual(aenderungen(nachrichten, { kategorie: '👤 Lea Leitung' }), [
    { id: 'a', kategorien: ['Rechnung', '👤 Lea Leitung'] },
    { id: 'b', kategorien: ['👤 Lea Leitung'] },
  ]);
  assert.deepEqual(aenderungen(nachrichten, { kategorie: null }), [
    { id: 'a', kategorien: ['Rechnung'] },
    { id: 'b', kategorien: [] },
  ]);
  assert.deepEqual(aenderungen(nachrichten, { kategorie: '👤 Tom Test', status: 'neu' }), [
    { id: 'a', flag: 'notFlagged' },
  ]);
  // Back from the archive: the archived ones return; another folder only without them
  const archiviert = [
    nachricht('a', 'k', '2026-11-01T08:00:00.000Z', 'x', 'complete', [], 'archiv'),
    nachricht('b', 'k', '2026-11-02T08:00:00.000Z', 'x', 'notFlagged', [], 'anderer'),
  ];
  assert.deepEqual(aenderungen(archiviert, { status: 'handlungsbedarf' }), [
    { id: 'a', flag: 'flagged', verschieben: 'inbox' },
  ]);
  assert.deepEqual(aenderungen([archiviert[1]], { status: 'neu' }), [
    { id: 'b', verschieben: 'inbox' },
  ]);
  const danach = nachAenderung(nachrichten, [{ id: 'b', verschieben: 'archive' }]);
  assert.equal(danach[1].ordner, 'archiv');
  assert.equal(danach[0], nachrichten[0]);
});

test('the start page shows new ones, and flagged ones to their person or to all', () => {
  const zeilen = konversationenAus(
    'kontakt',
    [
      nachricht('m1', 'neu', '2026-11-01T08:00:00.000Z'),
      nachricht('m2', 'erledigt', '2026-11-02T08:00:00.000Z', 'x', 'complete', [], 'archiv'),
      nachricht('m3', 'meins', '2026-10-01T08:00:00.000Z', 'x', 'flagged', ['👤 Lea Leitung']),
      nachricht('m4', 'offen', '2026-10-02T08:00:00.000Z', 'x', 'flagged'),
      nachricht('m5', 'fremd', '2026-10-03T08:00:00.000Z', 'x', 'flagged', ['👤 Tom Test']),
    ],
    PERSONEN
  );
  assert.deepEqual(
    fuerMich(zeilen, 'LEA@stamm-phoenix.de').map((zeile) => zeile.id),
    ['neu', 'offen', 'meins']
  );
  assert.deepEqual(
    fuerMich(zeilen, 'jemand@stamm-phoenix.de').map((zeile) => zeile.id),
    ['neu', 'offen']
  );
  // Without the people (the directory failed) a named person is not known: everyone sees it
  const ohnePersonen = konversationenAus(
    'kontakt',
    [nachricht('m5', 'fremd', '2026-10-03T08:00:00.000Z', 'x', 'flagged', ['👤 Tom Test'])],
    []
  );
  assert.deepEqual(
    fuerMich(ohnePersonen, 'lea@stamm-phoenix.de').map((zeile) => zeile.id),
    ['fremd']
  );
});

test('every mailbox names known teams and a unique address-safe id', () => {
  const roles = Object.values(CONFIG.staff.teams).map((team) => team.role);
  const ids = new Set<string>();
  for (const postfach of POSTFAECHER) {
    assert.match(postfach.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(postfach.id), `${postfach.id} twice`);
    ids.add(postfach.id);
    assert.ok(postfach.teams.length > 0);
    for (const team of postfach.teams) assert.ok(team in CONFIG.staff.teams, team);
    for (const role of postfachRoles(postfach)) assert.ok(roles.includes(role), role);
  }
});

test('the Outlook link of a message encodes the REST id', () => {
  assert.equal(
    nachrichtOutlookUrl('kontakt@stamm-phoenix.de', 'AAMk/abc+d='),
    'https://outlook.office.com/mail/kontakt%40stamm-phoenix.de/inbox/id/AAMk%2Fabc%2Bd%3D'
  );
});

test('the note about an assignment escapes the mail and links the conversation', () => {
  const [zeile] = konversationenAus(
    'kontakt',
    [nachricht('m1', 'AAQk/x+y=', '2026-11-03T08:00:00.000Z', '<b>Hilfe</b>')],
    []
  );
  const mail = zuweisungMail(POSTFAECHER[0], zeile, 'Vera Vorstand', 'https://example.test');
  assert.equal(mail.subject, 'Dir zugewiesen: <b>Hilfe</b>');
  assert.match(mail.html, /&lt;b&gt;Hilfe&lt;\/b&gt;/);
  assert.match(mail.html, /Vera Vorstand hat dir eine E-Mail im Kontakt-Postfach/);
  assert.match(
    mail.html,
    /https:\/\/example\.test\/leitendenbereich\/email\/kontakt#konversation=AAQk%2Fx%2By%3D/
  );
  assert.doesNotMatch(mail.html, /Text m1/);
});

test('the note goes out from the mailbox itself and leaves no copy in its Sent Items', async (t) => {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  t.mock.method(
    token,
    'getClient',
    () =>
      ({
        api: (path: string) => {
          const request = {
            middlewareOptions: () => request,
            options: () => request,
            post: async (body: Record<string, unknown>) => {
              calls.push({ path, body });
            },
          };
          return request;
        },
      }) as unknown as Client
  );
  const [zeile] = konversationenAus(
    'vorstand',
    [nachricht('m1', 'k1', '2026-11-03T08:00:00.000Z', 'Vertraulich')],
    []
  );
  const vorstand = POSTFAECHER.find((postfach) => postfach.id === 'vorstand')!;
  await postfachBenachrichtigung.senden(
    'tom@stamm-phoenix.de',
    vorstand,
    [zeile],
    'Vera',
    'https://x.test'
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/users/vorstand%40stamm-phoenix.de/sendMail');
  assert.equal(calls[0].body.saveToSentItems, false);
});

test('several assigned conversations make one note with a link to each', () => {
  const zeilen = konversationenAus(
    'kontakt',
    [
      nachricht('m1', 'AAQk/eins=', '2026-11-03T08:00:00.000Z', 'Erste <Frage>'),
      nachricht('m2', 'AAQk/zwei=', '2026-11-03T09:00:00.000Z', 'Zweite Frage'),
    ],
    []
  );
  const mail = zuweisungenMail(POSTFAECHER[0], zeilen, 'Vera Vorstand', 'https://example.test');
  assert.equal(mail.subject, 'Dir zugewiesen: 2 E-Mails im Kontakt-Postfach');
  assert.match(mail.html, /Vera Vorstand hat dir 2 E-Mails im Kontakt-Postfach/);
  assert.match(mail.html, /Erste &lt;Frage&gt;/);
  assert.match(mail.html, /#konversation=AAQk%2Feins%3D/);
  assert.match(mail.html, /#konversation=AAQk%2Fzwei%3D/);
  assert.equal(
    zuweisungenMail(POSTFAECHER[0], zeilen.slice(0, 1), 'Vera', 'https://example.test').subject,
    'Dir zugewiesen: Zweite Frage'
  );
});
