import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addMonths,
  kjrAbgabefrist,
  kjrFristStand,
  kjrRestzeit,
  offeneKjrFristen,
  tageBis,
} from '../src/lib/kjrFristen';
import type { CampflowEvent } from '../src/lib/types';

function event(id: string, title: string, end: string, patch: Partial<CampflowEvent> = {}) {
  return {
    id,
    title,
    published: true,
    start_date: end,
    end_date: end,
    max_persons: null,
    archived: false,
    url: null,
    collection: null,
    zuschussfaehig: true,
    keineAktion: false,
    ...patch,
  } as CampflowEvent;
}

test('the deadline is three months after the last day, shortened at the end of a month', () => {
  assert.equal(kjrAbgabefrist('2026-08-11'), '2026-11-11');
  assert.equal(kjrAbgabefrist('2026-09-18'), '2026-12-18');
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonths('2027-11-30', 3), '2028-02-29');
  assert.equal(addMonths('2026-11-30', 1), '2026-12-30');
});

test('days until a date count calendar days, also over a change of the clock', () => {
  assert.equal(tageBis('2026-11-11', '2026-10-01'), 41);
  assert.equal(tageBis('2026-12-18', '2026-10-01'), 78);
  assert.equal(tageBis('2026-10-01', '2026-10-01'), 0);
  assert.equal(tageBis('2026-10-31', '2026-10-24'), 7);
  assert.equal(tageBis('2026-03-14', '2026-10-01'), -201);
});

test('the time left reads heute, morgen or the number of days', () => {
  assert.equal(kjrRestzeit(0), 'heute');
  assert.equal(kjrRestzeit(1), 'morgen');
  assert.equal(kjrRestzeit(41), 'noch 41 Tage');
});

test('an Aktion that is over is highlighted from 14 days before its deadline on', () => {
  const sola = event('sola', 'Sommerlager', '2026-08-11');
  assert.deepEqual(kjrFristStand(sola, '2026-10-01'), {
    ende: '2026-08-11',
    frist: '2026-11-11',
    tage: 41,
    vorbei: true,
    bald: false,
  });
  assert.equal(kjrFristStand(sola, '2026-10-28')?.bald, true);
  assert.equal(kjrFristStand(sola, '2026-10-27')?.bald, false);
  assert.equal(kjrFristStand(sola, '2026-11-01')?.tage, 10);
  assert.equal(kjrFristStand(sola, '2026-11-01')?.bald, true);
  assert.equal(kjrFristStand(sola, '2026-11-11')?.bald, true);
  // Once the deadline has passed it is no longer „bald“ but overdue
  assert.equal(kjrFristStand(sola, '2026-11-12')?.bald, false);
  assert.equal(kjrFristStand(sola, '2026-11-12')?.tage, -1);
});

test('a coming Aktion has a deadline but is neither over nor highlighted', () => {
  const stand = kjrFristStand(event('herbst', 'Herbstwochenende', '2026-10-18'), '2026-10-01');
  assert.equal(stand?.vorbei, false);
  assert.equal(stand?.bald, false);
  assert.equal(stand?.frist, '2027-01-18');
});

test('the last day falls back to the first day; without a valid date there is no deadline', () => {
  const ohneEnde = event('x', 'X', '2026-08-11', { end_date: null });
  assert.equal(kjrFristStand(ohneEnde, '2026-10-01')?.ende, '2026-08-11');
  const leer = event('y', 'Y', '', { start_date: null, end_date: null });
  assert.equal(kjrFristStand(leer, '2026-10-01'), null);
  assert.equal(kjrFristStand(event('z', 'Z', 'bald'), '2026-10-01'), null);
});

test('the open deadlines list Aktionen that are over, the earliest deadline first', () => {
  const events = [
    event('stavo', 'Stammesversammlung', '2026-09-18'),
    event('sola', 'Sommerlager 2026 Oberjoch', '2026-08-11'),
    event('herbst', 'Wölflings-Herbstwochenende', '2026-10-18'),
    event('licht', 'Friedenslicht 2025', '2025-12-14'),
    event('ohne', 'Ohne Zuschuss', '2026-07-01', { zuschussfaehig: false }),
    event('archiv', 'Archiviertes Lager', '2026-08-12', { archived: true }),
  ];
  const offen = offeneKjrFristen(events, '2026-10-01');
  assert.deepEqual(
    offen.map((item) => [item.event.id, item.frist, kjrRestzeit(item.tage)]),
    [
      ['sola', '2026-11-11', 'noch 41 Tage'],
      ['archiv', '2026-11-12', 'noch 42 Tage'],
      ['stavo', '2026-12-18', 'noch 78 Tage'],
    ]
  );
  assert.equal(offen[0].bald, false);
  assert.equal(offeneKjrFristen(events, '2026-11-01')[0].bald, true);
  assert.deepEqual(offeneKjrFristen([], '2026-10-01'), []);
});

test('the same deadline is sorted by title', () => {
  const offen = offeneKjrFristen(
    [event('b', 'Zeltlager', '2026-08-11'), event('a', 'Ägyptenfahrt', '2026-08-11')],
    '2026-10-01'
  );
  assert.deepEqual(
    offen.map((item) => item.event.id),
    ['a', 'b']
  );
});
