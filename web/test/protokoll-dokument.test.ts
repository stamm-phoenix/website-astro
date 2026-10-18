import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser, parseHTML } from 'linkedom';
import { DOMParser as PMDOMParser, DOMSerializer } from '@tiptap/pm/model';
import { setServerHtmlParser } from '../src/lib/html.ts';
import {
  DokumentUmwandlung,
  dokumentSchema,
  punktNummern,
  punktLeer,
  rebuildDoc,
} from '../src/lib/protokollDokument.ts';
import { neuerInhalt } from '../../api/lib/protokoll-editor-model.ts';
import { parseProtokollMarkdown } from '../src/lib/protokollMarkdown.ts';
import type { ProtokollPunkt } from '../src/lib/types.ts';

setServerHtmlParser(new DOMParser() as unknown as Parameters<typeof setServerHtmlParser>[0]);

const schema = dokumentSchema();
const umwandlung = new DokumentUmwandlung(schema);

let counter = 0;
const nextId = (): string => `p${++counter}`;

/** Minutes as the editor stores them, with every kind of content. */
function beispiel(): ProtokollPunkt[] {
  counter = 0;
  const inhalt = neuerInhalt(nextId);
  const [stufen, reflexion] = inhalt.punkte;
  stufen.unterpunkte[0].text = 'Erste Hilfe geübt\n\n- Pflaster\n- Verbände\n\n- [ ] Zelte prüfen';
  stufen.unterpunkte[1].aufgaben.push({
    id: 'a1',
    titel: 'Zelte zählen',
    zustaendig: [{ login: 'lea', name: 'Lea Leiterin' }],
    faellig: '2026-11-03',
  });
  reflexion.text = '| Was | Wer |\n| --- | --- |\n| Essen | Tom |\n\n> Zitat\n\n```\ncode\n```';
  reflexion.termine.push({
    id: 't1',
    titel: 'Elternabend',
    datum: '2026-11-10',
    uhrzeit: '19:00',
    ort: 'Pfarrheim',
    zustaendig: [],
  });
  reflexion.aktion = { id: 'cf-1', titel: 'Winterlager', start: '2026-12-12', ende: '2026-12-14' };
  return inhalt.punkte;
}

/** The texts as the minutes render them: the editor writes the same Markdown in its own way. */
function gerendert(punkte: ProtokollPunkt[]): unknown[] {
  return punkte.map((punkt) => ({
    ...punkt,
    text: parseProtokollMarkdown(punkt.text),
    unterpunkte: gerendert(punkt.unterpunkte),
  }));
}

test('the agenda survives the way into the document and back', () => {
  const punkte = beispiel();
  const doc = umwandlung.doc(punkte);
  assert.deepEqual(gerendert(umwandlung.punkte(doc)), gerendert(punkte));
});

test('a title keeps its spaces, so typing on after a switch does not join words', () => {
  const punkte = beispiel();
  punkte[1].titel = 'Neuer ';
  assert.equal(umwandlung.punkte(umwandlung.doc(punkte))[1].titel, 'Neuer ');
});

test('a copied item takes its Aktion, tasks and dates through the clipboard', () => {
  const punkte = beispiel();
  const doc = umwandlung.doc(punkte);
  const { document } = parseHTML('<!doctype html><html><body></body></html>');
  const html = DOMSerializer.fromSchema(schema).serializeNode(doc.child(1), {
    document: document as unknown as Document,
  }) as unknown as HTMLElement;
  assert.ok(html.querySelector('[data-aktion]'));
  assert.ok(html.querySelector('[data-termine]'));
  const pasted = PMDOMParser.fromSchema(schema).parse(html as unknown as Node, {
    topNode: schema.nodes.punkt.create({ id: 'kopie' }),
  });
  const kopie = umwandlung.punkt(pasted);
  assert.deepEqual(kopie.aktion, punkte[1].aktion);
  assert.deepEqual(kopie.termine, punkte[1].termine);
  assert.deepEqual(kopie.aufgaben, punkte[1].aufgaben);
});

test('an empty agenda becomes one empty item', () => {
  const doc = umwandlung.doc([]);
  assert.equal(doc.childCount, 1);
  assert.ok(punktLeer(doc.firstChild!));
  assert.equal(umwandlung.punkte(doc)[0].text, '');
});

test('the numbers follow the document order', () => {
  const doc = umwandlung.doc(beispiel());
  const nummern = punktNummern(doc);
  assert.equal(nummern.get('p1'), '1.');
  assert.equal(nummern.get('p2'), '1a.');
  assert.equal(nummern.get('p6'), '1e.');
  assert.equal(nummern.get('p7'), '2.');
});

test('rebuilding keeps the nodes of unchanged items and moves sub-items', () => {
  const punkte = beispiel();
  const doc = umwandlung.doc(punkte);
  const moved = structuredClone(punkte);
  // The first sub-item becomes an item after the first one
  const [sub] = moved[0].unterpunkte.splice(0, 1);
  moved.splice(1, 0, sub);
  moved[2].text = 'Geändert';
  const rebuilt = rebuildDoc(umwandlung, doc, moved);
  assert.deepEqual(gerendert(umwandlung.punkte(rebuilt)), gerendert(moved));
  // The unchanged items keep their nodes, the changed one is new
  assert.equal(rebuilt.child(3), doc.child(2));
  assert.notEqual(rebuilt.child(2), doc.child(1));
  assert.equal(rebuilt.child(0).child(3), doc.child(0).child(4));
});

test('text that the editor cannot read is kept as it is', () => {
  const punkt = { ...neuerInhalt(nextId).punkte[1], text: '<b>x</b> bleibt Text' };
  const doc = umwandlung.doc([punkt]);
  assert.equal(umwandlung.punkte(doc)[0].text, '<b>x</b> bleibt Text');
});
