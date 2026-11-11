import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { setServerHtmlParser } from '../src/lib/html.ts';
import { clipboardContent, editorHtml, keptText } from '../src/lib/nichtEingesetzt.ts';
import { rescuePeople, rescueRowCount } from '../src/lib/taskRescue.ts';
import { rescueTags } from '../src/lib/nikolausWunschRettung.ts';
import { rettungsWarnung, type Draft } from '../src/lib/belegEntwurf.ts';
import { loginForNewWindow } from '../src/lib/appAnmeldung.ts';
import type { GeretteterWert } from '../src/lib/geretteteEingaben.ts';

// Kept values that form fields cannot hold, how „Noch nicht eingesetzt“ shows and copies them,
// and the links of the iPhone app that go through the login

setServerHtmlParser(new DOMParser() as unknown as Parameters<typeof setServerHtmlParser>[0]);

test('selected people keep name and login and are shown readably', () => {
  let people = [
    { name: 'Alex Beispiel', login: 'alex@example.test' },
    { name: 'Lena Brandstätter', login: '' },
  ];
  const field = rescuePeople(
    'Aufgabe 1: Zuständige',
    () => people,
    (next) => (people = next)
  );
  assert.equal(field.key, 'Aufgabe 1: Zuständige#custom');
  const value = field.get();
  assert.equal(field.describe(value), 'Alex Beispiel (alex@example.test), Lena Brandstätter');
  people = [];
  assert.equal(field.set(value), true);
  assert.deepEqual(people, [
    { name: 'Alex Beispiel', login: 'alex@example.test' },
    { name: 'Lena Brandstätter', login: '' },
  ]);
  for (const damaged of [
    '{',
    '[{"name":3}]',
    '"Alex"',
    JSON.stringify(Array(21).fill({ name: 'a', login: '' })),
  ]) {
    assert.equal(field.set(damaged), false, damaged);
  }
  assert.deepEqual(people.length, 2);
});

test('the number of template rows grows with empty rows and drops removed ones', () => {
  let rows = [{ title: 'A' }, { title: 'B' }, { title: 'C' }];
  const count = rescueRowCount(
    'Vorlagenaufgaben#custom',
    () => rows,
    (next) => (rows = next),
    () => ({ title: '' })
  );
  assert.equal(count.structure, true);
  assert.equal(count.get(), '3');
  assert.equal(count.describe('3'), '3 Aufgaben');
  assert.equal(count.set('2'), true);
  assert.deepEqual(rows, [{ title: 'A' }, { title: 'B' }]);
  assert.equal(count.set('4'), true);
  assert.deepEqual(rows, [{ title: 'A' }, { title: 'B' }, { title: '' }, { title: '' }]);
  for (const wrong of ['0', '51', '2.5', 'zwei']) assert.equal(count.set(wrong), false, wrong);
  assert.equal(rows.length, 4);
});

test('helper wishes come back including an emptied list', () => {
  const form = { positiveTags: ['Recovery wish'], negativeTags: [] as string[] };
  const positive = rescueTags(
    'Bevorzugt zu Familien mit',
    () => form.positiveTags,
    (tags) => ((form.positiveTags = tags), true)
  );
  const negative = rescueTags(
    'Nicht zu Familien mit',
    () => form.negativeTags,
    (tags) => ((form.negativeTags = tags), true)
  );
  const kept = [positive.get(), negative.get()];
  assert.deepEqual(kept, ['["Recovery wish"]', '[]']);
  assert.equal(positive.describe(kept[0]), 'Recovery wish');
  // The reopened dialog shows the old wishes from the server
  form.positiveTags = ['Old preferred'];
  form.negativeTags = ['Old restriction'];
  assert.equal(positive.set(kept[0]), true);
  assert.equal(negative.set(kept[1]), true);
  assert.deepEqual(form, { positiveTags: ['Recovery wish'], negativeTags: [] });
  assert.equal(positive.set('[1]'), false);
  assert.equal(positive.set('{'), false);
  const closed = rescueTags(
    'Nicht zu Familien mit',
    () => undefined,
    () => false
  );
  assert.equal(closed.get(), '[]');
  assert.equal(closed.set('[]'), false);
});

function kept(value: Partial<GeretteterWert>): GeretteterWert {
  return { key: 'Frage#0', kind: 'value', value: '', ...value };
}

test('cleared fields and removed check marks are named, not left blank', () => {
  assert.equal(keptText(kept({ kind: 'checked', value: 'false' })), 'nicht angehakt');
  assert.equal(keptText(kept({ kind: 'checked', value: 'true' })), 'angehakt');
  assert.equal(keptText(kept({ value: '' })), 'Leer');
  assert.equal(keptText(kept({ kind: 'editor', format: 'html', value: '' })), 'Leer');
  assert.equal(keptText(kept({ kind: 'custom', value: '[]', display: '' })), 'Leer');
  assert.equal(keptText(kept({ value: 'My unsaved question' })), 'My unsaved question');
  assert.equal(
    keptText(kept({ kind: 'custom', value: '[{"name":"Bea"}]', display: 'Bea' })),
    'Bea'
  );
});

const ANSWER =
  '<p>Siehe <strong>unbedingt</strong> die <a href="https://example.org/treffpunkt">Karte</a>.</p>';

test('a kept formatted answer is shown as HTML with its link, plain fields stay text', () => {
  const html = editorHtml(kept({ kind: 'editor', format: 'html', value: ANSWER }));
  assert.ok(html);
  assert.match(html, /<strong>unbedingt<\/strong>/);
  assert.match(html, /<a [^>]*href="https:\/\/example.org\/treffpunkt"[^>]*>Karte<\/a>/);
  assert.equal(editorHtml(kept({ kind: 'editor', format: 'markdown', value: '**x**' })), null);
  assert.equal(editorHtml(kept({ value: ANSWER })), null);
  // Script and handlers never survive
  assert.doesNotMatch(
    editorHtml(
      kept({ kind: 'editor', format: 'html', value: '<p onclick="x()">a</p><script>x()</script>' })
    ) ?? '',
    /onclick|script/
  );
});

test('copying a formatted answer gives HTML and readable text without markup', () => {
  const content = clipboardContent(kept({ kind: 'editor', format: 'html', value: ANSWER }));
  assert.match(content.html ?? '', /<strong>unbedingt<\/strong>/);
  assert.equal(content.text, 'Siehe unbedingt die Karte.');
  const long =
    Array.from({ length: 3 }, (_, index) => `<p>Absatz ${index}</p>`).join('') + '<p>a<br>b</p>';
  assert.equal(
    clipboardContent(kept({ kind: 'editor', format: 'html', value: long })).text,
    'Absatz 0\nAbsatz 1\nAbsatz 2\na\nb'
  );
});

test('copying a template row or a selection gives its readable text', () => {
  assert.deepEqual(
    clipboardContent(kept({ key: 'Aufgabentitel#1', value: 'Gerettete Aufgabe 1' })),
    {
      html: null,
      text: 'Gerettete Aufgabe 1',
    }
  );
  assert.equal(
    clipboardContent(kept({ kind: 'custom', value: '[…]', display: 'Bea Beispiel' })).text,
    'Bea Beispiel'
  );
});

function draft(value: Partial<Draft>): Draft {
  const bild = { width: 1, height: 1 } as unknown as Draft['bild'];
  return { original: bild, bild, quad: null, mode: 'original', pdf: null, ...value } as Draft;
}

test('the login link warns only while a chosen photo or PDF is not saved', () => {
  assert.equal(rettungsWarnung(null), null);
  assert.match(
    rettungsWarnung(draft({})) ?? '',
    /^Das ausgewählte Foto und sein Zuschnitt werden nicht gesichert\. .*schneide es wieder zu\.$/
  );
  assert.match(
    rettungsWarnung(draft({ pdf: new Blob(['%PDF']) })) ?? '',
    /^Das ausgewählte PDF wird nicht gesichert\./
  );
  // A saved photo opened again is kept with the receipt; only a new edit of it is unsaved
  const saved = draft({ aufbewahrt: new Blob(['x']) });
  assert.equal(rettungsWarnung(saved), null);
  assert.notEqual(rettungsWarnung({ ...saved, mode: 'farbe' } as Draft), null);
});

const ORIGIN = 'https://www.stamm-phoenix.de';
function link(href: string) {
  const url = new URL(href, ORIGIN);
  return { origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash };
}

test('a protected link in a new window goes through the login with query and fragment', () => {
  assert.equal(
    loginForNewWindow(link('/leitendenbereich/fotos#pfad=2026%2FSola'), ORIGIN),
    `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent('/leitendenbereich/fotos#pfad=2026%2FSola')}`
  );
  const photo = loginForNewWindow(link('/api/intern/pflege/belege/b1/foto?v=3'), ORIGIN);
  assert.equal(
    new URL(photo ?? '', ORIGIN).searchParams.get('post_login_redirect_uri'),
    '/api/intern/pflege/belege/b1/foto?v=3'
  );
  assert.ok(loginForNewWindow(link('/leitendenbereich'), ORIGIN));
});

test('public pages and other sites open as they are', () => {
  assert.equal(loginForNewWindow(link('/aktionen'), ORIGIN), null);
  assert.equal(loginForNewWindow(link('/leitendenbereich-app/'), ORIGIN), null);
  assert.equal(loginForNewWindow(link('/api/aktionen'), ORIGIN), null);
  assert.equal(loginForNewWindow(link('https://example.org/leitendenbereich/fotos'), ORIGIN), null);
});
