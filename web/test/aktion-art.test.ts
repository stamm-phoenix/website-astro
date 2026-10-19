import assert from 'node:assert/strict';
import test from 'node:test';
import { abrechnungGroups } from '../src/lib/abrechnungList.ts';
import { isAktion, keineAktionHinweis, nurAktionen } from '../src/lib/aktionArt.ts';
import { aktionTitles } from '../src/lib/campflowFields.ts';
import type { CampflowEvent } from '../src/lib/types.ts';

function event(
  id: string,
  title: string,
  start: string,
  end: string,
  keineAktion = false
): CampflowEvent {
  return {
    id,
    title,
    published: true,
    start_date: start,
    end_date: end,
    max_persons: null,
    archived: false,
    url: null,
    collection: null,
    zuschussfaehig: !keineAktion,
    keineAktion,
  };
}

const LAGER = event('evt_Lager', 'Sommerlager', '2026-08-01', '2026-08-10');
const PULLI = event('evt_Pulli', 'Stammespulli Dauer', '2026-06-24', '2040-07-10', true);

test('only events without the mark are Aktionen', () => {
  assert.equal(isAktion(LAGER), true);
  assert.equal(isAktion(PULLI), false);
  assert.deepEqual(nurAktionen([PULLI, LAGER]), [LAGER]);
});

test('names and long runs hint at events that are no Aktion, only while unmarked', () => {
  assert.equal(keineAktionHinweis(LAGER), null);
  assert.equal(keineAktionHinweis(PULLI), null);
  assert.match(keineAktionHinweis({ ...PULLI, keineAktion: false }) ?? '', /Bestellung/);
  assert.match(
    keineAktionHinweis(event('evt_X', 'Mitgliedsbeitrag', '2026-01-01', '2026-12-31')) ?? '',
    /mehrere Monate/
  );
  assert.match(
    keineAktionHinweis(event('evt_Y', 'Stammeshalstuch', '2026-05-01', '2026-05-01')) ?? '',
    /Bestellung/
  );
});

test('receipt suggestions list Aktionen first and orders last', () => {
  const now = Date.parse('2026-07-01');
  const titles = aktionTitles(
    [PULLI, LAGER, event('evt_Ausflug', 'Ausflug', '2026-05-01', '2026-05-01')],
    now
  );
  assert.deepEqual(titles, ['Ausflug', 'Sommerlager', 'Stammespulli Dauer']);
});

test('the Abrechnung lists events that are no Aktion apart, at the end', () => {
  const past = event('evt_Vorbei', 'Pfingstlager', '2026-05-20', '2026-05-25');
  const groups = abrechnungGroups([PULLI, past, LAGER], '2026-07-01', false);
  assert.deepEqual(
    groups.map((group) => [group.id, group.events.map((e) => e.id)]),
    [
      ['jetzt', ['evt_Vorbei']],
      ['geplant', ['evt_Lager']],
      ['sonstiges', ['evt_Pulli']],
    ]
  );
});
