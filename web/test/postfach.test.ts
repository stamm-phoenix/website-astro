import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KonversationZeile } from '../../api/lib/postfach-model';
import {
  dateiGroesse,
  filterAnzahl,
  filterKonversationen,
  hatExterneBilder,
  konversationAusHash,
  konversationHash,
  mailDokument,
  mailZeitKurz,
  textAlsHtml,
} from '../src/lib/postfachAnsicht';

function zeile(
  id: string,
  ungelesen: number,
  login: string | null,
  status: 'erledigt' | 'kein_handlungsbedarf' | null = null
): KonversationZeile {
  return {
    id,
    postfach: 'kontakt',
    betreff: id,
    von: { name: 'Erika', adresse: 'erika@example.invalid' },
    am: '2026-11-03T10:00:00.000Z',
    vorschau: '',
    anzahl: 1,
    ungelesen,
    hatAnhang: false,
    wichtig: false,
    zustaendig: login
      ? { login, name: login, vonLogin: login, vonName: login, am: '2026-11-03T10:00:00.000Z' }
      : null,
    erledigung: status
      ? { status, login: 'tom@x.de', name: 'Tom', am: '2026-11-03T11:00:00.000Z' }
      : null,
    wiederOffen: false,
  };
}

test('the filters of a mailbox and their counts; done ones only under „Erledigt“ and „Alle“', () => {
  const zeilen = [
    zeile('a', 1, null),
    zeile('b', 0, 'lea@stamm-phoenix.de'),
    zeile('c', 2, 'tom@x.de'),
    zeile('d', 1, 'lea@stamm-phoenix.de', 'erledigt'),
    zeile('e', 0, null, 'kein_handlungsbedarf'),
  ];
  const ids = (filter: Parameters<typeof filterKonversationen>[1]) =>
    filterKonversationen(zeilen, filter, 'Lea@stamm-phoenix.de').map((entry) => entry.id);
  assert.deepEqual(ids('offen'), ['a', 'b', 'c']);
  assert.deepEqual(ids('mir'), ['b']);
  assert.deepEqual(ids('ohne'), ['a']);
  assert.deepEqual(ids('ungelesen'), ['a', 'c']);
  assert.deepEqual(ids('erledigt'), ['d', 'e']);
  assert.deepEqual(ids('alle'), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(filterAnzahl(zeilen, 'lea@stamm-phoenix.de'), {
    offen: 3,
    mir: 1,
    ohne: 1,
    ungelesen: 2,
    erledigt: 2,
    alle: 5,
  });
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
