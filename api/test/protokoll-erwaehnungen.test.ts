import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIG } from '../lib/config';
import * as mail from '../lib/mail';
import { leitendenAdresse } from '../lib/leitenden-mail';
import type { MdToken } from '../lib/protokoll-markdown';
import {
  MARKED_OPTIONS,
  erwaehnbar,
  erwaehnungLogin,
  erwaehnungMarkdown,
  erwaehnungenIn,
  markdownTree,
  normalizeBullets,
} from '../lib/protokoll-markdown';
import type { ProtokollInhalt, ProtokollPunkt } from '../lib/protokoll-editor-model';
import {
  MAX_ERWAEHNUNG_MAILS,
  benachrichtigeErwaehnte,
  erwaehnungPersonen,
  protokollErwaehnungen,
} from '../lib/protokoll-erwaehnungen';
import { overrideConfig } from './fixtures/config';

/** `marked` is an ES module; the compiled tests are CommonJS and load it like the PDF does. */
async function tree(text: string) {
  const { Lexer } = await import('marked');
  return markdownTree(
    new Lexer(MARKED_OPTIONS).lex(normalizeBullets(text)) as unknown as MdToken[]
  );
}

function punkt(titel: string, text: string, unterpunkte: ProtokollPunkt[] = []): ProtokollPunkt {
  return {
    id: titel,
    titel,
    aktion: null,
    text,
    aufgaben: [],
    termine: [],
    projekt: null,
    offeneAufgaben: [],
    unterpunkte,
  };
}

function inhalt(punkte: ProtokollPunkt[]): ProtokollInhalt {
  return {
    kopf: {
      sitzungsleitung: [],
      protokollant: [],
      beginn: '',
      ende: '',
      teilnehmende: [],
      externe: '',
    },
    punkte,
    naechsteSitzung: { datum: '', uhrzeit: '', ort: '' },
  };
}

const LEA = { login: 'lea@stamm-phoenix.de', name: 'Lea Leiterin' };
const MAX = { login: 'max@stamm-phoenix.de', name: 'Max Muster' };

test('a mention is a person: link that becomes its own node, other links stay links', async () => {
  const md = `Danke ${erwaehnungMarkdown(LEA)} und [Seite](https://example.org).`;
  assert.equal(
    md,
    'Danke [@Lea Leiterin](person:lea@stamm-phoenix.de) und [Seite](https://example.org).'
  );
  assert.deepEqual(await tree(md), [
    {
      type: 'paragraph',
      children: [
        { type: 'text', text: 'Danke ' },
        { type: 'erwaehnung', login: LEA.login, name: 'Lea Leiterin' },
        { type: 'text', text: ' und ' },
        { type: 'link', href: 'https://example.org', children: [{ type: 'text', text: 'Seite' }] },
        { type: 'text', text: '.' },
      ],
    },
  ]);
});

test('names with Markdown characters survive, logins with spaces or brackets are no mention', async () => {
  const odd = { login: 'x@stamm-phoenix.de', name: 'Anna [Orga] *Chef*_in' };
  const [block] = await tree(erwaehnungMarkdown(odd));
  assert.deepEqual(block, {
    type: 'paragraph',
    children: [{ type: 'erwaehnung', login: odd.login, name: 'Anna [Orga] *Chef*_in' }],
  });
  assert.equal(erwaehnungLogin('person:a b@x.de'), null);
  assert.equal(erwaehnungLogin('https://example.org'), null);
  assert.equal(erwaehnungLogin('PERSON:lea@x.de'), 'lea@x.de');
  assert.equal(erwaehnbar({ login: '' }), false);
  assert.equal(erwaehnbar(LEA), true);
});

test('mentions are found in lists, quotes, tables and formatting, not in code', async () => {
  const md = [
    `- **${erwaehnungMarkdown(LEA)}** macht das`,
    `> ${erwaehnungMarkdown(MAX)}`,
    '',
    `| Wer |`,
    `| --- |`,
    `| ${erwaehnungMarkdown(LEA)} |`,
    '',
    '`[@Code](person:code@stamm-phoenix.de)`',
  ].join('\n');
  assert.deepEqual(
    erwaehnungenIn(await tree(md)).map((m) => m.login),
    [LEA.login, MAX.login, LEA.login]
  );
});

test('each person is listed once with the items naming them, sub-items included', async () => {
  const result = await protokollErwaehnungen(
    inhalt([
      punkt('Stufenberichte', `${erwaehnungMarkdown(LEA)} berichtet`, [
        punkt('Wölflinge', `${erwaehnungMarkdown(MAX)} und ${erwaehnungMarkdown(LEA)}`),
      ]),
      punkt('', `Nochmal [@LEA](person:LEA@stamm-phoenix.de)`),
      punkt('Ohne', 'Nur Text mit lea@stamm-phoenix.de'),
    ])
  );
  assert.deepEqual(result, [
    {
      login: LEA.login,
      name: 'Lea Leiterin',
      punkte: ['1. Stufenberichte', '1a. Wölflinge', '2. Ohne Titel'],
    },
    { login: MAX.login, name: 'Max Muster', punkte: ['1a. Wölflinge'] },
  ]);
});

const MINUTES = inhalt([
  punkt(
    'Sommerlager',
    `${erwaehnungMarkdown(LEA)}, ${erwaehnungMarkdown(MAX)} und [@Fremd](person:fremd@example.org)`
  ),
]);

const INPUT = {
  inhalt: MINUTES,
  title: 'Leitendenrunde',
  date: '2026-11-12',
  approvedBy: 'MAX@stamm-phoenix.de',
  url: 'https://example.test/protokoll?id=1',
};

test('the approval notes known people through the leaders mail, not the approver or strangers', async (t) => {
  overrideConfig(t, CONFIG.protokolle, { sender: 'protokolle@stamm-phoenix.de' });
  t.mock.method(erwaehnungPersonen, 'logins', async () => new Set([LEA.login, MAX.login]));
  t.mock.method(leitendenAdresse, 'campflow', async () => 'lea@example.org');
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  const warnings: string[] = [];

  const count = await benachrichtigeErwaehnte(INPUT, (message) => warnings.push(message));

  assert.equal(count, 1);
  assert.equal(send.mock.callCount(), 1);
  const [to, subject, html, sender] = send.mock.calls[0].arguments;
  assert.deepEqual(to, [LEA.login, 'lea@example.org']);
  assert.equal(subject, 'Erwähnt im Protokoll: Leitendenrunde vom 12.11.2026');
  assert.match(html ?? '', /1\. Sommerlager/);
  assert.match(html ?? '', /protokoll\?id=1/);
  assert.equal(sender, 'protokolle@stamm-phoenix.de');
  assert.deepEqual(warnings, ['[protokoll-editor] 1 Erwähnte ohne bekannten Login']);
});

test('a failing mail is reported and does not stop the others', async (t) => {
  overrideConfig(t, CONFIG.protokolle, { sender: 'protokolle@stamm-phoenix.de' });
  t.mock.method(erwaehnungPersonen, 'logins', async () => new Set([LEA.login, MAX.login]));
  t.mock.method(leitendenAdresse, 'campflow', async () => '');
  t.mock.method(mail, 'sendMail', async (to: string | string[]) => {
    if (to === LEA.login) throw new Error('Graph down');
  });
  const warnings: string[] = [];

  const count = await benachrichtigeErwaehnte(
    { ...INPUT, approvedBy: 'jemand@stamm-phoenix.de' },
    (message) => warnings.push(message)
  );

  assert.equal(count, 1);
  assert.ok(warnings.includes('[protokoll-editor] Mail an eine erwähnte Person fehlgeschlagen'));
});

test('without a sender or mentions nothing is looked up or sent', async (t) => {
  const logins = t.mock.method(erwaehnungPersonen, 'logins', async () => new Set<string>());
  const send = t.mock.method(mail, 'sendMail', async () => undefined);
  overrideConfig(t, CONFIG.protokolle, { sender: '' });
  assert.equal(await benachrichtigeErwaehnte(INPUT, () => undefined), 0);
  overrideConfig(t, CONFIG.protokolle, { sender: 'protokolle@stamm-phoenix.de' });
  assert.equal(
    await benachrichtigeErwaehnte(
      { ...INPUT, inhalt: inhalt([punkt('A', 'Text')]) },
      () => undefined
    ),
    0
  );
  assert.equal(logins.mock.callCount(), 0);
  assert.equal(send.mock.callCount(), 0);
  assert.ok(MAX_ERWAEHNUNG_MAILS > 0);
});
