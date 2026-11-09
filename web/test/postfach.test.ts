import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KonversationZeile } from '../../api/lib/postfach-model';
import {
  dateiGroesse,
  FILTER_START,
  filterAktiv,
  filterAnzahl,
  filterKonversationen,
  type PostfachFilter,
  hatExterneBilder,
  konversationAusHash,
  konversationHash,
  mailDokument,
  mailZeitKurz,
  textAlsHtml,
} from '../src/lib/postfachAnsicht';

function zeile(
  id: string,
  status: KonversationZeile['status'],
  login: string | null
): KonversationZeile {
  return {
    id,
    postfach: 'kontakt',
    betreff: id,
    von: { name: 'Erika', adresse: 'erika@example.invalid' },
    am: '2026-11-03T10:00:00.000Z',
    vorschau: '',
    anzahl: 1,
    hatAnhang: false,
    wichtig: false,
    zustaendig: login ? { login, name: login } : null,
    status,
  };
}

test('the filters of a mailbox combine, and each count keeps the other filter', () => {
  const zeilen = [
    zeile('a', 'neu', null),
    zeile('b', 'handlungsbedarf', 'lea@stamm-phoenix.de'),
    zeile('c', 'handlungsbedarf', 'tom@x.de'),
    zeile('d', 'erledigt', 'lea@stamm-phoenix.de'),
    zeile('e', 'erledigt', null),
  ];
  const ich = 'Lea@stamm-phoenix.de';
  const ids = (filter: Partial<PostfachFilter>) =>
    filterKonversationen(zeilen, { ...FILTER_START, ...filter }, ich).map((entry) => entry.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(ids({ stand: 'neu' }), ['a']);
  assert.deepEqual(ids({ stand: 'handlungsbedarf' }), ['b', 'c']);
  assert.deepEqual(ids({ stand: 'erledigt' }), ['d', 'e']);
  // Who is responsible counts for done ones too, and the groups combine
  assert.deepEqual(ids({ zustaendig: 'mir' }), ['b', 'd']);
  assert.deepEqual(ids({ zustaendig: 'mir', stand: 'handlungsbedarf' }), ['b']);
  assert.deepEqual(ids({ zustaendig: 'niemand' }), ['a', 'e']);

  // Each count says what that choice would show with the other filter kept
  assert.deepEqual(filterAnzahl(zeilen, { ...FILTER_START, stand: 'handlungsbedarf' }, ich), {
    stand: { alle: 5, neu: 1, handlungsbedarf: 2, erledigt: 2 },
    zustaendig: { alle: 2, mir: 1, niemand: 0 },
  });
  assert.equal(filterAktiv(FILTER_START), false);
  assert.equal(filterAktiv({ ...FILTER_START, stand: 'neu' }), true);
});

test('the open conversation round-trips through the address', () => {
  const id = 'AAQkAD/abc+def==';
  assert.equal(konversationAusHash(konversationHash(id)), id);
  assert.equal(konversationAusHash('#pfad=x'), null);
  assert.equal(konversationAusHash('#konversation=%E0%A4%A'), null);
});

test('mail times are short in lists', () => {
  const now = new Date('2026-11-03T15:00:00.000Z');
  assert.equal(mailZeitKurz('2026-11-03T13:32:00.000Z', now), '14:32');
  assert.equal(mailZeitKurz('2026-11-02T13:32:00.000Z', now), 'gestern');
  assert.equal(mailZeitKurz('2026-10-14T13:32:00.000Z', now), '14. Okt.');
  assert.equal(mailZeitKurz('2025-10-14T13:32:00.000Z', now), '14.10.2025');
  assert.equal(dateiGroesse(182_000), '178 KB');
  assert.equal(dateiGroesse(3_500_000), '3,3 MB');
});

test('the mail frame blocks remote images until asked and escapes plain text', () => {
  const html = '<p>Hi</p><img src="https://tracker.example/p.gif">';
  assert.equal(hatExterneBilder(html), true);
  assert.equal(hatExterneBilder('<img src="data:image/png;base64,AA">'), false);
  assert.equal(hatExterneBilder('<img src="//bilder.example/banner.png">'), true);
  assert.equal(hatExterneBilder('<img src=//bilder.example/b.png>'), true);
  assert.equal(
    hatExterneBilder('<img srcset="data:image/png;base64,AA 1x, https://x.example/b.png 2x">'),
    true
  );
  assert.equal(hatExterneBilder('<td background="http://x.example/bg.gif">'), true);
  assert.equal(hatExterneBilder('<div style="background:url(\'//x.example/a.png\')">'), true);
  assert.equal(hatExterneBilder('<img src="data:image/png;base64,ab//cd==">'), false);
  assert.equal(hatExterneBilder('<a href="https://example.invalid">Link</a>'), false);
  assert.match(mailDokument(html, false), /img-src data:;/);
  assert.match(mailDokument(html, true), /img-src data: https:;/);
  assert.match(mailDokument(html, false), /default-src 'none'/);
  assert.doesNotMatch(mailDokument(html, false), /script-src/);
  assert.equal(
    textAlsHtml('<b>&</b>\nx'),
    '<div style="white-space:pre-wrap">&lt;b&gt;&amp;&lt;/b&gt;\nx</div>'
  );
});
