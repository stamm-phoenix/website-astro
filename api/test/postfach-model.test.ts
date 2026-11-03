import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fuerMich,
  istGelesen,
  konversationenAus,
  type InboxNachricht,
  type Zustaendigkeit,
} from '../lib/postfach-model';
import { POSTFAECHER, postfachRoles, nachrichtOutlookUrl } from '../lib/postfach-liste';
import { CONFIG } from '../lib/config';
import { postfachBenachrichtigung, zuweisungMail, zuweisungenMail } from '../lib/postfach-mails';
import * as token from '../lib/token';
import type { Client } from '@microsoft/microsoft-graph-client';

function nachricht(
  id: string,
  konversation: string,
  am: string,
  betreff = 'Frage'
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
  };
}

const ZUSTAENDIG: Zustaendigkeit = {
  login: 'lea@stamm-phoenix.de',
  name: 'Lea Leitung',
  vonLogin: 'vera@stamm-phoenix.de',
  vonName: 'Vera Vorstand',
  am: '2026-11-02T10:00:00.000Z',
};

test('messages are grouped into conversations with the newest message on top', () => {
  const zeilen = konversationenAus(
    'kontakt',
    [
      nachricht('m1', 'k1', '2026-11-01T08:00:00.000Z', 'Alt'),
      nachricht('m2', 'k1', '2026-11-03T08:00:00.000Z', 'AW: Alt'),
      nachricht('m3', 'k2', '2026-11-02T08:00:00.000Z', 'Andere'),
    ],
    { marken: new Map([['m1', true]]), gelesenBis: null },
    new Map([['k2', ZUSTAENDIG]])
  );
  assert.deepEqual(
    zeilen.map((zeile) => [
      zeile.id,
      zeile.betreff,
      zeile.anzahl,
      zeile.ungelesen,
      zeile.hatAnhang,
    ]),
    [
      ['k1', 'AW: Alt', 2, 1, true],
      ['k2', 'Andere', 1, 1, false],
    ]
  );
  assert.equal(zeilen[1].zustaendig?.name, 'Lea Leitung');
  assert.equal(zeilen[0].zustaendig, null);
});

test('a mark wins over the read-until time, both ways', () => {
  const stand = {
    marken: new Map([
      ['alt-ungelesen', false],
      ['neu-gelesen', true],
    ]),
    gelesenBis: '2026-11-01T00:00:00.000Z',
  };
  assert.equal(istGelesen({ id: 'alt', am: '2026-10-30T00:00:00.000Z' }, stand), true);
  assert.equal(istGelesen({ id: 'alt-ungelesen', am: '2026-10-30T00:00:00.000Z' }, stand), false);
  assert.equal(istGelesen({ id: 'neu', am: '2026-11-02T00:00:00.000Z' }, stand), false);
  assert.equal(istGelesen({ id: 'neu-gelesen', am: '2026-11-02T00:00:00.000Z' }, stand), true);
});

test('the start page shows unread conversations and those assigned to the person', () => {
  const zeilen = konversationenAus(
    'kontakt',
    [
      nachricht('m1', 'gelesen', '2026-11-01T08:00:00.000Z'),
      nachricht('m2', 'ungelesen', '2026-11-02T08:00:00.000Z'),
      nachricht('m3', 'meins', '2026-10-01T08:00:00.000Z'),
    ],
    { marken: new Map([['m1', true]]), gelesenBis: '2026-10-15T00:00:00.000Z' },
    new Map([['meins', ZUSTAENDIG]])
  );
  assert.deepEqual(
    fuerMich(zeilen, 'LEA@stamm-phoenix.de').map((zeile) => zeile.id),
    ['ungelesen', 'meins']
  );
  assert.deepEqual(
    fuerMich(zeilen, 'jemand@stamm-phoenix.de').map((zeile) => zeile.id),
    ['ungelesen']
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
    { marken: new Map(), gelesenBis: null },
    new Map()
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
    { marken: new Map(), gelesenBis: null },
    new Map()
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
    { marken: new Map(), gelesenBis: null },
    new Map()
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
