import assert from 'node:assert/strict';
import test from 'node:test';
import { neuerInhalt } from '../../api/lib/protokoll-editor-model.ts';
import { abgleichen } from '../src/lib/protokollMarkdownAbgleich.ts';
import {
  dokumentText,
  grenzen,
  liesDokument,
  punktAnZeile,
} from '../src/lib/protokollMarkdownDokument.ts';
import { personFinder } from '../src/lib/protokollMarkdownZeilen.ts';
import type { ProtokollPunkt } from '../src/lib/types.ts';

const LEA = { login: 'lea', name: 'Lea Leiterin' };
const finde = personFinder([LEA]);

let counter = 0;
const nextId = (): string => `p${++counter}`;

/** Minutes with every kind of content the document shows or keeps. */
function beispiel(): ProtokollPunkt[] {
  counter = 0;
  const [stufen, reflexion] = neuerInhalt(nextId).punkte;
  stufen.unterpunkte[0].text = 'Erste Hilfe geübt\n\n## Material\n\n- [ ] Zelte prüfen';
  stufen.unterpunkte[1].aufgaben.push({
    id: 'a1',
    titel: 'Zelte zählen; danach melden',
    zustaendig: [LEA, { login: '', name: 'Tom' }],
    faellig: '2026-11-03',
  });
  reflexion.text = 'Aufgabe: das war nur Text\n\n```\n# kein Punkt\n```';
  reflexion.zeitraum = { start: '2026-12-12', ende: '2026-12-14' };
  reflexion.termine.push({
    id: 't1',
    titel: 'Elternabend',
    datum: '2026-11-10',
    uhrzeit: '19:00',
    ort: 'Pfarrheim',
    zustaendig: [],
  });
  reflexion.aktion = { id: 'cf-1', titel: 'Winterlager', start: '2026-12-12', ende: '2026-12-14' };
  reflexion.projekt = { id: 7, titel: 'Winterlager' };
  reflexion.offeneAufgaben = [{ id: 3, titel: 'Bus', zustaendig: [], faellig: '', erledigt: true }];
  return [stufen, reflexion];
}

function zurueck(text: string, vorher: ProtokollPunkt[], beiseite: ProtokollPunkt[] = []) {
  return abgleichen(liesDokument(text, finde).punkte, vorher, beiseite, nextId);
}

test('the agenda survives the way into the document and back unchanged', () => {
  const punkte = beispiel();
  const text = dokumentText(punkte);
  assert.match(text, /^# Stufenberichte$/m);
  assert.match(text, /^#### Material$/m);
  assert.match(text, /^Aufgabe\\: das war nur Text$/m);
  assert.match(text, /^Zeitraum: 12\.12\.2026 – 14\.12\.2026$/m);
  assert.match(
    text,
    /^Aufgabe: Zelte zählen\\; danach melden; zuständig: Lea Leiterin, Tom; bis: 03\.11\.2026$/m
  );
  assert.match(text, /^Termin: Elternabend; am: 10\.11\.2026; um: 19:00; in: Pfarrheim$/m);
  assert.deepEqual(zurueck(text, punkte).punkte, punkte);
  assert.deepEqual(liesDokument(text, finde).probleme, []);
});

test('an edited text is read back with its headings and escapes undone', () => {
  const punkte = beispiel();
  const text = dokumentText(punkte).replace('Erste Hilfe geübt', 'Erste Hilfe geübt, gut');
  const sub = zurueck(text, punkte).punkte[0].unterpunkte[0];
  assert.equal(sub.id, punkte[0].unterpunkte[0].id);
  assert.equal(sub.text, 'Erste Hilfe geübt, gut\n\n## Material\n\n- [ ] Zelte prüfen');
});

test('task and date lines become tasks and dates with people from the list', () => {
  const punkte = beispiel();
  const text = `${dokumentText(punkte)}\nAufgabe: Bus buchen; zuständig: lea leiterin, Max; bis: 1.12.26\nTermin: Hütte; am: 2026-12-01; um: 18 Uhr\n`;
  const reflexion = zurueck(text, punkte).punkte[1];
  assert.deepEqual(reflexion.aufgaben.at(-1), {
    id: reflexion.aufgaben.at(-1)?.id,
    titel: 'Bus buchen',
    zustaendig: [LEA, { login: '', name: 'Max' }],
    faellig: '2026-12-01',
  });
  assert.equal(reflexion.termine.at(-1)?.uhrzeit, '18:00');
  assert.equal(reflexion.termine.at(-1)?.datum, '2026-12-01');
  // The untouched date keeps its id
  assert.equal(reflexion.termine[0].id, 't1');
});

test('typing a title keeps the item with its Aktion, project and open tasks', () => {
  const punkte = beispiel();
  const text = dokumentText(punkte).replace('# Aktionsrückblick', '# Rückblick');
  const reflexion = zurueck(text, punkte).punkte[1];
  assert.equal(reflexion.titel, 'Rückblick');
  assert.equal(reflexion.id, punkte[1].id);
  assert.deepEqual(reflexion.projekt, punkte[1].projekt);
  assert.deepEqual(reflexion.aktion, punkte[1].aktion);
  assert.deepEqual(reflexion.offeneAufgaben, punkte[1].offeneAufgaben);
});

test('an item cut out and pasted elsewhere comes back with what the document does not show', () => {
  const punkte = beispiel();
  const text = dokumentText(punkte);
  const start = text.indexOf('# Aktionsrückblick');
  const block = text.slice(start);
  const ohne = zurueck(text.slice(0, start), punkte);
  assert.equal(ohne.punkte.length, 1);
  const wieder = zurueck(`${block}\n${text.slice(0, start)}`, ohne.punkte, ohne.beiseite);
  assert.equal(wieder.punkte[0].id, punkte[1].id);
  assert.deepEqual(wieder.punkte[0].projekt, punkte[1].projekt);
  assert.equal(wieder.punkte[1].id, punkte[0].id);
});

test('a sub-item becomes an item of its own when its ## turns into #', () => {
  const punkte = beispiel();
  const sub = punkte[0].unterpunkte[1];
  const text = dokumentText(punkte).replace(`## ${sub.titel}`, `# ${sub.titel}`);
  const result = zurueck(text, punkte).punkte;
  assert.equal(result.length, 3);
  assert.equal(result[1].id, sub.id);
  assert.equal(result[1].aufgaben[0].id, 'a1');
});

test('problems name the line and nothing typed is dropped', () => {
  const text = [
    '## Allein',
    'Vorab',
    'Termin: Fest; am: 31.02.2026; um: 25:00',
    'Aufgabe: Putzen; farbe: blau',
    '```',
    '# im Code',
  ].join('\n');
  const { punkte, probleme } = liesDokument(text, finde);
  assert.deepEqual(
    probleme.map((p) => p.zeile),
    [1, 3, 3, 4, 5]
  );
  assert.equal(punkte[0].ebene, 0);
  assert.equal(punkte[0].text, 'Vorab\n```\n# im Code');
  assert.equal(punkte[0].aufgaben[0].titel, 'Putzen; farbe: blau');
});

test('a title with a backslash or semicolon reads back unchanged', () => {
  const punkte = beispiel();
  // A backslash before the semicolon and one at the end of the title
  const titel = 'Pfad C:\\; Rest\\\\';
  const aufgabe = { id: 'a2', titel, zustaendig: [LEA], faellig: '' };
  punkte[1].aufgaben.push(aufgabe);
  const text = dokumentText(punkte);
  assert.ok(text.includes('Aufgabe: Pfad C:\\\\\\; Rest\\\\\\\\; zuständig: Lea Leiterin'));
  assert.deepEqual(zurueck(text, punkte).punkte[1].aufgaben.at(-1), aufgabe);
  const getippt = liesDokument('# A\nAufgabe: a\\b; bis: 01.12.2026', finde);
  assert.equal(getippt.punkte[0].aufgaben[0].titel, 'a\\b');
  assert.equal(getippt.punkte[0].aufgaben[0].faellig, '2026-12-01');
});

test('an empty document keeps one empty item', () => {
  const punkte = beispiel();
  const result = zurueck('', punkte).punkte;
  assert.equal(result.length, 1);
  assert.equal(result[0].titel, '');
});

test('the item at the cursor and the limits are found by line', () => {
  const { punkte } = liesDokument('# A\n\ntext\n\n## B\n', finde);
  assert.equal(punktAnZeile(punkte, 2), 0);
  assert.equal(punktAnZeile(punkte, 4), 1);
  const lang = liesDokument(`# A\n\n${'x'.repeat(20_001)}\n`, finde).punkte;
  assert.equal(grenzen(lang)[0]?.zeile, 1);
});
