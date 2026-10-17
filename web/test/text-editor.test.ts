import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser } from 'linkedom';
import { markdownManager, unwrapListParagraphs } from '../src/lib/textEditor.ts';
import { setServerHtmlParser } from '../src/lib/html.ts';
import { PROTOKOLL_TEXT_FEATURES } from '../src/lib/protokollEditor.ts';
import { parseProtokollMarkdown } from '../src/lib/protokollMarkdown.ts';

// The HTML helpers need a DOM parser outside the browser
setServerHtmlParser(new DOMParser() as unknown as Parameters<typeof setServerHtmlParser>[0]);

const manager = markdownManager(PROTOKOLL_TEXT_FEATURES);

/** Markdown after a pass through the editor, as `TextEditor.svelte` would store it. */
function roundTrip(markdown: string): string {
  return manager.serialize(manager.parse(markdown));
}

const MINUTES = `# Rückblick

Text mit **fett**, *kursiv*, ~~durchgestrichen~~ und \`Code\`, ein [Link](https://example.org) und www.example.org.
Zweite Zeile im selben Absatz.

- Punkt eins
  - verschachtelt
    1. nummeriert
    2. weiter
- Punkt zwei

- [ ] offen
- [x] erledigt

| Was | Wer | Bis |
| --- | :-: | --: |
| Zelte prüfen | Lea | 3.11. |
| Essen planen | Tom | 5.11. |

> Zitat über
> zwei Zeilen

\`\`\`
Codeblock
\`\`\`

---

Schluss mit E-Mail an <kontakt@stamm-phoenix.de>.
`;

test('the minutes render the same tree before and after the editor', () => {
  const after = roundTrip(MINUTES);
  assert.deepEqual(parseProtokollMarkdown(after), parseProtokollMarkdown(MINUTES));
});

test('a second pass changes nothing more', () => {
  const once = roundTrip(MINUTES);
  assert.equal(roundTrip(once), once);
});

test('single line breaks stay line breaks, as the minutes show them', () => {
  const after = roundTrip('Zeile eins\nZeile zwei');
  assert.deepEqual(parseProtokollMarkdown(after), parseProtokollMarkdown('Zeile eins\nZeile zwei'));
  assert.equal(parseProtokollMarkdown(after)[0].type, 'paragraph');
  assert.ok(after.includes('\n'), after);
});

test('the old bullets of the minutes are read as a list', () => {
  // The editor normalizes `• ` itself (`normalizeBullets`); here the parser gets the result
  const before = '• eins\n• zwei';
  const after = roundTrip(before.replace(/^• /gm, '- '));
  assert.deepEqual(parseProtokollMarkdown(after), parseProtokollMarkdown(before));
});

test('angle brackets and ampersands are stored as typed, not as entities', () => {
  assert.equal(roundTrip('a < b & c > d, ich <3 Pfadis'), 'a < b & c > d, ich <3 Pfadis');
  assert.equal(roundTrip('`a < b` und\n\n```\nx & y\n```'), '`a < b` und\n\n```\nx & y\n```');
  // Markdown syntax typed as text is still escaped
  assert.equal(roundTrip('2 \\* 3 und \\[eckig]'), '2 \\* 3 und \\[eckig\\]');
});

test('raw HTML stays text', () => {
  const after = roundTrip('Hallo <script>alert(1)</script> <img onerror=x src=y>');
  const blocks = parseProtokollMarkdown(after);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'paragraph');
  assert.deepEqual(
    blocks,
    parseProtokollMarkdown('Hallo <script>alert(1)</script> <img onerror=x src=y>')
  );
});

test('unsafe links are not written as links', () => {
  const after = roundTrip('[Klick](javascript:alert(1))');
  const blocks = parseProtokollMarkdown(after);
  assert.equal(blocks[0].type, 'paragraph');
  const inline = blocks[0].type === 'paragraph' ? blocks[0].children : [];
  assert.ok(
    inline.every((node) => node.type !== 'link'),
    after
  );
});

test('list items lose the paragraph the editor wraps around them, as the site stores them', () => {
  assert.equal(
    unwrapListParagraphs(
      '<p>Text</p><ul><li><p>eins</p></li><li><p>zwei</p><ul><li><p>tief</p></li></ul></li></ul>'
    ),
    '<p>Text</p><ul><li>eins</li><li>zwei<ul><li>tief</li></ul></li></ul>'
  );
  // Two paragraphs in one item stay as they are
  assert.equal(
    unwrapListParagraphs('<ul><li><p>eins</p><p>zwei</p></li></ul>'),
    '<ul><li><p>eins</p><p>zwei</p></li></ul>'
  );
  assert.equal(
    unwrapListParagraphs('<p>Nur <strong>Text</strong></p>'),
    '<p>Nur <strong>Text</strong></p>'
  );
});
