import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser } from 'linkedom';
import { markdownManager } from '../src/lib/textEditor.ts';
import { setServerHtmlParser } from '../src/lib/html.ts';
import { PROTOKOLL_TEXT_FEATURES } from '../src/lib/protokollEditor.ts';
import {
  erwaehnungMarkdown,
  erwaehnungSuche,
  erwaehnungTreffer,
} from '../src/lib/protokollErwaehnung.ts';
import { freigabeErwaehnte, freigabeMeldung } from '../src/lib/protokollFreigabe.ts';
import type { ProtokollInhalt, ProtokollPunkt } from '../../api/lib/protokoll-editor-model.ts';
import type { PersonOption } from '../../api/lib/protokoll-editor-model.ts';

setServerHtmlParser(new DOMParser() as unknown as Parameters<typeof setServerHtmlParser>[0]);

const PERSONEN: PersonOption[] = [
  { login: 'lea@stamm-phoenix.de', name: 'Lea Leiterin', gruppe: 'leitende' },
  { login: 'max@stamm-phoenix.de', name: 'Max Muster', gruppe: 'leitende' },
  { login: 'jo@stamm-phoenix.de', name: 'Jörg Älter', gruppe: 'altleitende' },
  { login: '', name: 'Gast ohne Login', gruppe: 'weitere' },
  { login: 'LEA@stamm-phoenix.de', name: 'Lea doppelt', gruppe: 'weitere' },
];

test('an @ at the start of a word starts a search, one inside an address does not', () => {
  assert.deepEqual(erwaehnungSuche('Danke @le'), { query: 'le', start: 6 });
  assert.deepEqual(erwaehnungSuche('@'), { query: '', start: 0 });
  assert.deepEqual(erwaehnungSuche('(@Max Mu'), { query: 'Max Mu', start: 1 });
  assert.equal(erwaehnungSuche('mail an lea@stamm'), null);
  assert.equal(erwaehnungSuche('@Max Muster und'), null);
  // A space between first and last name keeps the search, a second word after it ends it
  assert.deepEqual(erwaehnungSuche('@Lea '), { query: 'Lea ', start: 0 });
  assert.equal(erwaehnungSuche('@Lea Leiterin hat'), null);
});

test('matches start with the name, then a word, then anywhere; only once and with a login', () => {
  const names = (query: string) => erwaehnungTreffer(PERSONEN, query).map((p) => p.name);
  assert.deepEqual(names(''), ['Lea Leiterin', 'Max Muster', 'Jörg Älter']);
  assert.deepEqual(names('mu'), ['Max Muster']);
  assert.deepEqual(names('jorg'), ['Jörg Älter']);
  assert.deepEqual(names('alter'), ['Jörg Älter']);
  assert.deepEqual(names('eit'), ['Lea Leiterin']);
  assert.deepEqual(names('gast'), []);
  assert.equal(erwaehnungTreffer(PERSONEN, '', 2).length, 2);
});

test('the formatting editor keeps mentions as they are stored', () => {
  const manager = markdownManager(PROTOKOLL_TEXT_FEATURES);
  const markdown = `Danke ${erwaehnungMarkdown({ login: 'lea@stamm-phoenix.de', name: 'Lea [Orga]' })} und **${erwaehnungMarkdown(PERSONEN[1])}**`;
  const doc = manager.parse(markdown);
  const mentions: unknown[] = [];
  const walk = (node: { type?: string; attrs?: unknown; content?: unknown[] }): void => {
    if (node.type === 'erwaehnung') mentions.push(node.attrs);
    for (const child of node.content ?? []) walk(child as typeof node);
  };
  walk(doc);
  assert.deepEqual(mentions, [
    { login: 'lea@stamm-phoenix.de', name: 'Lea [Orga]' },
    { login: 'max@stamm-phoenix.de', name: 'Max Muster' },
  ]);
  // A mention is a chip without formatting of its own; the mention itself survives
  assert.equal(
    manager.serialize(doc),
    markdown.replace(`**${erwaehnungMarkdown(PERSONEN[1])}**`, erwaehnungMarkdown(PERSONEN[1]))
  );
  const plain = `${erwaehnungMarkdown(PERSONEN[0])} macht das.`;
  assert.equal(manager.serialize(manager.parse(plain)), plain);
});

test('the message after approval names the notified people', () => {
  assert.equal(
    freigabeMeldung({ fileName: 'a.pdf', aufgaben: 1, benachrichtigt: 2 }, 'x'),
    'Freigegeben. „a.pdf“ liegt jetzt im Protokoll-Ordner. Eine Aufgabe im Modul Aufgaben angelegt. 2 erwähnte Personen wurden benachrichtigt.'
  );
  assert.equal(
    freigabeMeldung({ benachrichtigt: 1 }, 'Runde'),
    'Freigegeben. „Runde“ liegt jetzt im Protokoll-Ordner. Eine erwähnte Person wurde benachrichtigt.'
  );
});

function punkt(text: string, unterpunkte: ProtokollPunkt[] = []): ProtokollPunkt {
  return {
    id: text,
    titel: 'Punkt',
    aktion: null,
    text,
    aufgaben: [],
    termine: [],
    projekt: null,
    zeitraum: null,
    offeneAufgaben: [],
    unterpunkte,
  };
}

test('the approval dialog names everyone mentioned once, without the approving person', () => {
  const [lea, max] = PERSONEN;
  const inhalt = {
    punkte: [
      punkt(`${erwaehnungMarkdown(max)} und ${erwaehnungMarkdown(lea)}`, [
        punkt(`nochmal ${erwaehnungMarkdown(max)}`),
      ]),
      punkt('ohne Erwähnung'),
    ],
  } as ProtokollInhalt;
  assert.deepEqual(freigabeErwaehnte(inhalt, 'LEA@stamm-phoenix.de'), ['Max Muster']);
  assert.deepEqual(freigabeErwaehnte(inhalt, ''), ['Max Muster', 'Lea Leiterin']);
});
