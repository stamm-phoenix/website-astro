import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLOG_IMAGE_FILE,
  escapeAttribute,
  sanitizeBlogHtml,
  sanitizeRichText,
  sanitizeRichTextWithLength,
} from '../lib/validation/rich-text';
import { ValidationError } from '../lib/validation/errors';
import { validateBlogImages, validateBlogPost } from '../lib/validation/blog';
import type { BlogImage } from '../lib/validation/blog';

function fields(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

// --- Rich text ---

test('rich text keeps formatting tags without attributes and escapes everything else', () => {
  assert.equal(
    sanitizeRichText(
      '<p class="x" onclick="y()">A <STRONG>b</STRONG><br/>c</p><h2>t</h2><img src=x>'
    ),
    '<p>A <strong>b</strong><br>c</p>t'
  );
  assert.equal(
    sanitizeRichText('1 < 2 & 3 > 2 &amp; &copy;'),
    '1 &lt; 2 &amp; 3 &gt; 2 &amp; &copy;'
  );
  assert.equal(
    sanitizeRichText(
      'a<script>evil()</script>b<style>p{}</style>c<!-- note -->d<iframe>x</iframe>'
    ),
    'abcd'
  );
  assert.equal(sanitizeRichText('<a href="https://a.de">x</a>'), 'x');
  assert.equal(sanitizeRichText('  <p>x</p>  '), '<p>x</p>');
});

test('rich text counts visible characters and recognises empty editor markup', () => {
  assert.deepEqual(sanitizeRichTextWithLength('<p>Hallo Welt</p>'), {
    html: '<p>Hallo Welt</p>',
    textLength: 10,
    hasVisibleText: true,
  });
  for (const html of [
    '',
    '<p><br></p>',
    '<p>&nbsp;&#160;&#xA0;</p>',
    '<p>​</p>',
    '<script>x</script>',
  ]) {
    assert.equal(sanitizeRichTextWithLength(html).hasVisibleText, false, html);
  }
  assert.equal(sanitizeRichTextWithLength('<p>a</p> <p>b &amp; c</p>').textLength, 1 + 9);
});

test('rich text links are only allowed for http(s) and mailto and keep their href only', () => {
  const options = (html: string) => sanitizeBlogHtml(html, []).html;
  assert.equal(
    options(
      '<a href="https://a.de/?q=1&amp;r=2" target="_blank">A</a>' +
        "<a href='mailto:x@y.de'>B</a><a href=HTTP://c.de>C</a>" +
        '<a href="javascript:x()">D</a><a href="/rel">E</a><a>F</a>'
    ),
    '<a href="https://a.de/?q=1&amp;r=2">A</a><a href="mailto:x@y.de">B</a>' +
      '<a href="HTTP://c.de">C</a>DEF'
  );
  assert.equal(options('<a href="https://a.de">open'), '<a href="https://a.de">open</a>');
  assert.equal(escapeAttribute('a&b"c<d>'), 'a&amp;b&quot;c&lt;d&gt;');
});

test('blog HTML keeps headings and only the images of the post', () => {
  assert.equal(
    sanitizeBlogHtml(
      '<h2>T</h2><h3 id="x">U</h3><img data-bild="bild-1.jpg" src="x"><img data-bild="bild-2.jpg">' +
        '<img data-bild="../bild-1.jpg"><img src="x"></img>',
      ['bild-1.jpg', '../bild-1.jpg']
    ).html,
    '<h2>T</h2><h3>U</h3><img data-bild="bild-1.jpg">'
  );
  assert.ok(BLOG_IMAGE_FILE.test('bild-1234567890123456.jpg'));
  for (const file of [
    'bild-.jpg',
    'bild-1.png',
    'bild-1.jpg ',
    'x/bild-1.jpg',
    'bild-12345678901234567.jpg',
  ]) {
    assert.ok(!BLOG_IMAGE_FILE.test(file), file);
  }
});

// --- Blog posts ---

const POST = { title: 'Sommerlager', date: '2026-07-01', published: true, content: '<p>Hallo</p>' };

test('a blog post is normalised and its content sanitized against its images', () => {
  assert.deepEqual(
    validateBlogPost(
      {
        title: '  Sommer   Lager ',
        date: '2026-07-01',
        published: true,
        content:
          '<h2 class="x">Tag 1</h2><img data-bild="bild-1.jpg"><img data-bild="bild-2.jpg"><script>x()</script>',
      },
      ['bild-1.jpg']
    ),
    {
      title: 'Sommer Lager',
      date: '2026-07-01',
      published: true,
      content: '<h2>Tag 1</h2><img data-bild="bild-1.jpg">',
    }
  );
  assert.equal(validateBlogPost({ ...POST, published: undefined }, []).published, false);
  assert.equal(validateBlogPost({ ...POST, published: false }, []).published, false);
  assert.equal(validateBlogPost({ ...POST, content: undefined }, []).content, '');
  assert.equal(validateBlogPost({ ...POST, content: 5 }, []).content, '');
  assert.equal(validateBlogPost({ ...POST, date: '2024-02-29' }, []).date, '2024-02-29');
});

test('a blog post reports the German messages per field', () => {
  assert.deepEqual(
    fields(() => validateBlogPost(null, [])),
    {
      title: 'Bitte einen Titel angeben.',
      date: 'Bitte ein gültiges Datum angeben.',
    }
  );
  assert.equal(
    fields(() => validateBlogPost({ ...POST, title: 'x'.repeat(256) }, [])).title,
    'einen Titel darf höchstens 255 Zeichen lang sein.'
  );
  assert.equal(
    fields(() => validateBlogPost({ ...POST, title: 4 }, [])).title,
    'einen Titel ist ungültig.'
  );
  for (const date of ['2026-02-30', '1.7.2026', 20260701, null, ' 2026-07-01']) {
    assert.equal(
      fields(() => validateBlogPost({ ...POST, date }, [])).date,
      'Bitte ein gültiges Datum angeben.'
    );
  }
  for (const published of [null, 'true', 1]) {
    assert.equal(
      fields(() => validateBlogPost({ ...POST, published }, [])).published,
      'Der Status ist ungültig.'
    );
  }
});

test('the text of a blog post is limited by visible characters and by its markup', () => {
  assert.equal(validateBlogPost({ ...POST, content: 'x'.repeat(20000) }, []).content.length, 20000);
  assert.equal(
    fields(() => validateBlogPost({ ...POST, content: 'x'.repeat(20001) }, [])).content,
    'Der Text darf höchstens 20000 Zeichen lang sein.'
  );
  assert.equal(
    fields(() => validateBlogPost({ ...POST, content: '<b>a</b>'.repeat(9000) }, [])).content,
    'Der Text ist zu lang, bitte kürzen oder aufteilen.'
  );
  assert.deepEqual(
    fields(() => validateBlogPost({ title: '', date: 'x', content: 'x'.repeat(20001) }, [])),
    {
      title: 'Bitte einen Titel angeben.',
      date: 'Bitte ein gültiges Datum angeben.',
      content: 'Der Text darf höchstens 20000 Zeichen lang sein.',
    }
  );
});

// --- Blog images ---

const IMAGES: BlogImage[] = [
  { file: 'bild-1.jpg', alt: 'Zelt', width: 1600, height: 900 },
  { file: 'bild-2.jpg', alt: '', width: 800, height: 600 },
];
const CHANGED = 'Die Bilder haben sich inzwischen geändert. Bitte neu laden.';

test('blog images take new alt texts and a new order and keep everything else', () => {
  assert.deepEqual(
    validateBlogImages(
      {
        images: [
          { file: 'bild-2.jpg', alt: '  Am   Feuer ', width: 1, height: 1 },
          { file: 'bild-1.jpg', alt: 7 },
        ],
      },
      IMAGES
    ),
    [
      { file: 'bild-2.jpg', alt: 'Am Feuer', width: 800, height: 600 },
      { file: 'bild-1.jpg', alt: '', width: 1600, height: 900 },
    ]
  );
  assert.deepEqual(validateBlogImages({ images: [] }, []), []);
  assert.equal(
    validateBlogImages(
      { images: [{ file: 'bild-1.jpg', alt: 'x'.repeat(300) }, { file: 'bild-2.jpg' }] },
      IMAGES
    )[0]?.alt.length,
    300
  );
});

test('blog images reject changed, duplicated and missing files with one message', () => {
  for (const body of [
    null,
    {},
    { images: 'x' },
    { images: [IMAGES[0]] },
    { images: [...IMAGES, IMAGES[0]] },
    { images: [IMAGES[0], IMAGES[0]] },
    { images: [IMAGES[0], { file: 'bild-3.jpg', alt: '' }] },
    { images: [IMAGES[0], 'bild-2.jpg'] },
    { images: [IMAGES[0], null] },
    { images: [IMAGES[0], { alt: 'x' }] },
    { images: [IMAGES[0], { file: 2 }] },
  ]) {
    assert.deepEqual(
      fields(() => validateBlogImages(body, IMAGES)),
      { images: CHANGED },
      String(JSON.stringify(body))
    );
  }
});

test('blog images limit the length of an alt text', () => {
  assert.deepEqual(
    fields(() =>
      validateBlogImages(
        { images: [{ file: 'bild-1.jpg', alt: 'x'.repeat(301) }, { file: 'bild-2.jpg' }] },
        IMAGES
      )
    ),
    { images: 'Eine Bildbeschreibung darf höchstens 300 Zeichen lang sein.' }
  );
  // The first problem in the list wins
  assert.deepEqual(
    fields(() =>
      validateBlogImages(
        {
          images: [
            { file: 'bild-1.jpg', alt: 'x'.repeat(301) },
            { file: 'bild-9.jpg', alt: '' },
          ],
        },
        IMAGES
      )
    ),
    { images: 'Eine Bildbeschreibung darf höchstens 300 Zeichen lang sein.' }
  );
  assert.deepEqual(
    fields(() =>
      validateBlogImages(
        {
          images: [
            { file: 'bild-9.jpg', alt: '' },
            { file: 'bild-2.jpg', alt: 'x'.repeat(301) },
          ],
        },
        IMAGES
      )
    ),
    { images: CHANGED }
  );
  assert.deepEqual(
    fields(() =>
      validateBlogImages({ images: [{ file: 'bild-1.jpg', alt: 'x'.repeat(301) }] }, IMAGES)
    ),
    { images: CHANGED }
  );
});
