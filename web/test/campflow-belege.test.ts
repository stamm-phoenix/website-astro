import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  campflowStatusLabel,
  inCampflowSelection,
  isOwnCampflowBeleg,
  matchesCampflowSearch,
  meineBelege,
  sortCampflowBelege,
} from '../src/lib/campflowBelege';
import type { CampflowBeleg, CampflowBelegeData, StaffBeleg } from '../src/lib/types';

function beleg(values: Partial<CampflowBeleg> & Pick<CampflowBeleg, 'id'>): CampflowBeleg {
  return {
    number: null,
    status: 'open',
    description: '',
    date: null,
    amountCent: -1000,
    openCent: -1000,
    paidBy: null,
    costUnits: [],
    categories: [],
    pages: 1,
    fileName: null,
    uploadedAt: null,
    viaWebsite: false,
    submittedByMe: false,
    ...values,
  };
}

const isKim = ({ name }: { name: string }) => name === 'Kim';

test('the state names whether an Auslage is paid back', () => {
  assert.equal(
    campflowStatusLabel(beleg({ id: 'a', status: 'unbooked' })).label,
    'In CampFlow, noch nicht gebucht'
  );
  assert.deepEqual(campflowStatusLabel(beleg({ id: 'b', paidBy: 'Kim' })), {
    label: 'Gebucht, Erstattung offen',
    tone: 'warning',
  });
  assert.equal(campflowStatusLabel(beleg({ id: 'c' })).label, 'Gebucht');
  assert.equal(
    campflowStatusLabel(beleg({ id: 'd', status: 'settled', paidBy: 'Kim' })).label,
    'Erstattet'
  );
  assert.equal(campflowStatusLabel(beleg({ id: 'e', status: 'settled' })).label, 'Bezahlt');
});

test('own receipts are those submitted here or paid out of pocket by name', () => {
  assert.equal(isOwnCampflowBeleg(beleg({ id: 'a', paidBy: 'Kim' }), isKim), true);
  assert.equal(isOwnCampflowBeleg(beleg({ id: 'b', submittedByMe: true }), isKim), true);
  assert.equal(isOwnCampflowBeleg(beleg({ id: 'c', paidBy: 'Sam' }), isKim), false);
});

test('filters by Kostenstelle, Kategorie and search words', () => {
  const lager = beleg({
    id: 'a',
    number: '2026-7',
    description: 'REWE Grillgut',
    costUnits: [{ id: 'cun_1', name: 'Sommerlager' }],
    categories: [{ id: 'cat_1', name: 'Verpflegung', costUnitId: 'cun_1' }],
  });
  assert.equal(inCampflowSelection(lager, { costUnitId: '', categoryId: '' }), true);
  assert.equal(inCampflowSelection(lager, { costUnitId: 'cun_1', categoryId: 'cat_1' }), true);
  assert.equal(inCampflowSelection(lager, { costUnitId: 'cun_2', categoryId: '' }), false);
  assert.equal(inCampflowSelection(lager, { costUnitId: 'cun_1', categoryId: 'cat_2' }), false);
  assert.equal(matchesCampflowSearch(lager, 'rewe sommer'), true);
  assert.equal(matchesCampflowSearch(lager, '2026-7 verpflegung'), true);
  assert.equal(matchesCampflowSearch(lager, 'edeka'), false);
});

test('unbooked receipts come first, then the newest Belegdatum', () => {
  const sorted = sortCampflowBelege([
    beleg({ id: 'old', date: '2026-01-01', number: '2026-1' }),
    beleg({ id: 'new', date: '2026-09-01', number: '2026-9' }),
    beleg({ id: 'waiting', status: 'unbooked', uploadedAt: '2026-10-01 10:00:00' }),
  ]);
  assert.deepEqual(
    sorted.map((entry) => entry.id),
    ['waiting', 'new', 'old']
  );
});

test('my receipts merge the module and CampFlow, each receipt once', () => {
  const submitted = (id: string, values: Partial<StaffBeleg> = {}) =>
    ({
      id,
      shop: `Laden ${id}`,
      date: '2026-10-01',
      amountCent: 500,
      status: 'Eingereicht',
      submittedBy: 'kim@example.test',
      campflow: null,
      ...values,
    }) as StaffBeleg;
  const campflow: CampflowBelegeData = {
    loadedAt: '2026-10-21T10:00:00Z',
    costUnits: [],
    belege: [
      beleg({
        id: 'exp_1',
        number: '2026-1',
        description: 'Edeka',
        date: '2026-09-01',
        paidBy: 'Kim',
      }),
      beleg({
        id: 'exp_2',
        number: '2026-2',
        description: 'Fremd',
        date: '2026-09-02',
        paidBy: 'Sam',
      }),
      beleg({
        id: 'exp_3',
        number: '2026-3',
        description: 'Hochgeladen',
        date: '2026-08-01',
        submittedByMe: true,
      }),
    ],
  };
  const belege = [
    submitted('1'),
    submitted('2', { submittedBy: 'sam@example.test' }),
    // Kept here after its upload; listed with its state in CampFlow
    submitted('3', {
      status: 'Angenommen',
      campflow: { state: 'Hochgeladen', number: '2026-3' } as StaffBeleg['campflow'],
    }),
  ];
  const mine = meineBelege(belege, campflow, 'Kim@Example.test', isKim);
  assert.deepEqual(
    mine.map((entry) => [entry.title, entry.label, entry.amountCent]),
    [
      ['Laden 1', 'Eingereicht', 500],
      ['Edeka', 'Gebucht, Erstattung offen', 1000],
      ['Hochgeladen', 'Gebucht', 1000],
    ]
  );
  // While CampFlow loads, the module's receipts show already
  assert.equal(meineBelege(belege, null, 'kim@example.test', isKim).length, 2);
});
