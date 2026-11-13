import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CampflowMitglied, LeitendenKonto, Person } from '../../api/lib/personen-model';
import {
  speichereVorschlaege,
  vorschlagAngebote,
  vorschlaegeMeldung,
} from '../src/lib/personenVorschlaege';

const konto = (login: string, name: string): LeitendenKonto => ({ login, name }) as LeitendenKonto;
const mitglied = (id: string): CampflowMitglied => ({ id }) as CampflowMitglied;
const person = (id: number, login: string): Person =>
  ({ id, login, etag: `v${id}` }) as unknown as Person;

test('only accounts with a suggestion are offered, together with their saved person', () => {
  const konten = [konto('a@x', 'Anna'), konto('b@x', 'Ben'), konto('c@x', 'Cem')];
  const offers = vorschlagAngebote(
    konten,
    new Map([
      ['a@x', mitglied('1')],
      ['c@x', mitglied('3')],
    ]),
    new Map([['c@x', person(7, 'c@x')]])
  );
  assert.deepEqual(
    offers.map((o) => [o.konto.login, o.mitglied.id, o.row?.id]),
    [
      ['a@x', '1', undefined],
      ['c@x', '3', 7],
    ]
  );
});

test('a saved person is patched with its version, a new one is created; a failure leaves the others', async () => {
  const sent: string[] = [];
  const offers = vorschlagAngebote(
    [konto('a@x', 'Anna'), konto('b@x', 'Ben'), konto('c@x', 'Cem')],
    new Map([
      ['a@x', mitglied('1')],
      ['b@x', mitglied('2')],
      ['c@x', mitglied('3')],
    ]),
    new Map([['a@x', person(7, 'a@x')]])
  );
  const result = await speichereVorschlaege(offers, async (method, url, body) => {
    sent.push(`${method} ${url} ${String(body.etag ?? '-')} ${String(body.campflowPersonId)}`);
    if (body.login === 'b@x') throw new Error('offline');
  });
  assert.deepEqual(result, { saved: 2, failed: 1 });
  assert.deepEqual(sent, [
    'PATCH /intern/pflege/personen/7 v7 1',
    'POST /intern/pflege/personen - 2',
    'POST /intern/pflege/personen - 3',
  ]);
});

test('the message counts what was saved and what was not', () => {
  assert.equal(vorschlaegeMeldung({ saved: 1, failed: 0 }), '1 Vorschlag übernommen.');
  assert.equal(vorschlaegeMeldung({ saved: 3, failed: 0 }), '3 Vorschläge übernommen.');
  assert.equal(
    vorschlaegeMeldung({ saved: 2, failed: 1 }),
    '2 übernommen, 1 nicht gespeichert. Bitte die übrigen einzeln verknüpfen.'
  );
});
