import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  belegEintraege,
  campflowStand,
  eintragKostenstellen,
  matchesBelegFilter,
  type BelegFilter,
} from '../src/lib/belegEintraege';
import { applyZahlung, zahlungOf, type BelegForm } from '../src/lib/belegForm';
import { meineBelege } from '../src/lib/campflowBelege';
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

const submitted = (id: string, values: Partial<StaffBeleg> = {}) =>
  ({
    id,
    etag: 'AAA=',
    shop: `Laden ${id}`,
    date: '2026-10-01',
    amountCent: 500,
    paidBy: 'Kim',
    payout: false,
    aktion: 'Sommerlager',
    note: '',
    status: 'Eingereicht',
    reviewNote: '',
    submittedBy: 'kim@example.test',
    hasImage: true,
    aiCheck: null,
    campflow: null,
    ...values,
  }) as StaffBeleg;

const lager = { id: 'cun_1', name: 'Sommerlager' };
const campflow: CampflowBelegeData = {
  loadedAt: '2026-10-21T10:00:00Z',
  costUnits: [
    { ...lager, archived: false, categories: [{ id: 'cat_1', name: 'Verpflegung' }] },
    { id: 'cun_2', name: 'Leer', archived: false, categories: [] },
  ],
  belege: [
    beleg({
      id: 'exp_1',
      number: '2026-1',
      description: 'Edeka',
      date: '2026-09-01',
      paidBy: 'Kim',
      costUnits: [lager],
      categories: [{ id: 'cat_1', name: 'Verpflegung', costUnitId: 'cun_1' }],
    }),
    beleg({
      id: 'exp_2',
      number: '2026-2',
      description: 'Fremd',
      date: '2026-09-02',
      paidBy: 'Sam',
      status: 'settled',
      amountCent: 2000,
      openCent: 0,
    }),
    beleg({
      id: 'exp_3',
      number: '2026-3',
      description: 'Hochgeladen',
      date: '2026-08-01',
      submittedByMe: true,
    }),
    beleg({
      id: 'rcp_9',
      status: 'unbooked',
      fileName: 'neu.pdf',
      uploadedAt: '2026-10-20 08:00:00',
      amountCent: 0,
    }),
  ],
};
const isKim = ({ name }: { name: string }) => name === 'Kim';
const NO_FILTER: Omit<BelegFilter, 'quelle'> = {
  stand: '',
  costUnitId: '',
  categoryId: '',
  search: '',
  onlyMine: false,
};

test('the state names whether an Auslage is paid back', () => {
  assert.deepEqual(campflowStand(beleg({ id: 'a', status: 'unbooked' })), {
    stand: 'ungebucht',
    label: 'Noch nicht gebucht',
    tone: 'neutral',
  });
  assert.equal(campflowStand(beleg({ id: 'b', paidBy: 'Kim' })).label, 'Gebucht, Erstattung offen');
  assert.equal(campflowStand(beleg({ id: 'c' })).label, 'Gebucht');
  assert.equal(
    campflowStand(beleg({ id: 'd', status: 'settled', paidBy: 'Kim' })).label,
    'Erstattet'
  );
  assert.equal(campflowStand(beleg({ id: 'e', status: 'settled' })).label, 'Bezahlt');
});

test('one list holds the receipts here and in CampFlow, each with its source', () => {
  const belege = [
    submitted('1'),
    submitted('2', {
      status: 'Abgelehnt',
      reviewNote: 'Unleserlich',
      submittedBy: 'sam@example.test',
    }),
    // Kept here after its upload: listed once, as the receipt here
    submitted('3', {
      status: 'Angenommen',
      campflow: {
        state: 'Hochgeladen',
        number: '2026-3',
        costUnitId: 'cun_1',
        categoryId: 'cat_1',
      } as StaffBeleg['campflow'],
    }),
  ];
  const eintraege = belegEintraege(belege, campflow, { isIch: isKim });
  assert.deepEqual(
    eintraege.map((e) => [e.key, e.quelle, e.stand, e.own]),
    [
      // Paid by the Stamm: nobody's, also not of who submitted it
      ['website-1', 'website', 'eingereicht', false],
      ['website-3', 'website', 'angenommen', false],
      ['campflow-rcp_9', 'campflow', 'ungebucht', false],
      ['website-2', 'website', 'abgelehnt', false],
      ['campflow-exp_2', 'campflow', 'bezahlt', false],
      ['campflow-exp_1', 'campflow', 'gebucht', true],
    ]
  );
  const unbooked = eintraege.find((e) => e.key === 'campflow-rcp_9')!;
  assert.equal(unbooked.previewUrl, '/api/intern/abrechnung/belege/rcp_9/vorschau');
  assert.equal(unbooked.hasAmount, false);
  assert.equal(unbooked.title, 'neu.pdf');
  const kept = eintraege.find((e) => e.key === 'website-3')!;
  assert.deepEqual(kept.tags[0], { label: 'In CampFlow als 2026-3', tone: 'warning' });
  assert.deepEqual([kept.costUnitIds, kept.categoryIds], [['cun_1'], ['cat_1']]);
  // The Aktion named like a Kostenstelle counts for its filter
  assert.deepEqual(eintraege.find((e) => e.key === 'website-1')!.costUnitIds, ['cun_1']);
  assert.equal(eintraege.find((e) => e.key === 'website-2')!.hinweis, 'Unleserlich');
});

test('filters by state, Kostenstelle, Kategorie, own receipts and search words', () => {
  const eintraege = belegEintraege([submitted('1', { payout: true })], campflow, {
    isIch: isKim,
  });
  const keys = (filter: Partial<BelegFilter>) =>
    eintraege.filter((e) => matchesBelegFilter(e, { ...NO_FILTER, ...filter })).map((e) => e.key);
  assert.deepEqual(keys({ stand: 'bezahlt' }), ['campflow-exp_2']);
  assert.deepEqual(keys({ costUnitId: 'cun_1' }), ['website-1', 'campflow-exp_1']);
  assert.deepEqual(keys({ costUnitId: 'cun_1', categoryId: 'cat_1' }), ['campflow-exp_1']);
  // Own Auslagen only: not the one submitted here by Kim without an Auslage (exp_3)
  assert.deepEqual(keys({ onlyMine: true }), ['website-1', 'campflow-exp_1']);
  assert.deepEqual(keys({ search: 'edeka verpflegung' }), ['campflow-exp_1']);
  assert.deepEqual(keys({ search: '2026-2' }), ['campflow-exp_2']);
  // Only Kostenstellen with receipts are offered
  assert.deepEqual(
    eintragKostenstellen(eintraege, campflow).map((k) => [k.id, k.categories.length]),
    [['cun_1', 1]]
  );
});

test('a receipt kept here stays mine when someone else submitted my Auslage', () => {
  const kept = submitted('5', {
    status: 'Angenommen',
    submittedBy: 'sam@example.test',
    paidBy: 'Kim',
    payout: true,
    campflow: { state: 'Hochgeladen', number: '2026-1' } as StaffBeleg['campflow'],
  });
  const eintraege = belegEintraege([kept], campflow, { isIch: isKim });
  const mine = eintraege.filter((e) => matchesBelegFilter(e, { ...NO_FILTER, onlyMine: true }));
  assert.ok(mine.some((e) => e.key === 'website-5'));
  assert.ok(meineBelege([kept], campflow, isKim).some((b) => b.key === 'website-5'));
  // Found by the CampFlow number it shows
  assert.deepEqual(
    eintraege
      .filter((e) => matchesBelegFilter(e, { ...NO_FILTER, search: '2026-1' }))
      .map((e) => e.key),
    ['website-5']
  );
});

test('my receipts are my own Auslagen, newest first, whoever submitted them', () => {
  const belege = [
    submitted('1', { payout: true }),
    // Submitted by Kim for Sam, paid by the Stamm, booked to the savings book: not Kim's
    submitted('2', { payout: true, paidBy: 'Sam' }),
    submitted('3', { payout: false, paidBy: '' }),
    submitted('4', { payout: true, paidBy: 'Sparbuch' }),
    // Submitted by Sam for Kim
    submitted('5', { payout: true, submittedBy: 'sam@example.test', date: '2026-10-02' }),
  ];
  const mine = meineBelege(belege, campflow, isKim);
  assert.deepEqual(
    mine.map((entry) => [entry.title, entry.label]),
    [
      ['Laden 5', 'Eingereicht'],
      ['Laden 1', 'Eingereicht'],
      ['Edeka', 'Gebucht, Erstattung offen'],
    ]
  );
  // A savings book booking is marked as such
  const sparbuch = belegEintraege(belege, campflow, { isIch: isKim }).find(
    (e) => e.key === 'website-4'
  )!;
  assert.equal(sparbuch.tags[0]!.label, 'Umbuchung Sparbuch');
  // While CampFlow loads, the receipts here show already
  assert.equal(meineBelege(belege, null, isKim).length, 2);
});

test('the choice of payment sets who gets the Auslage', () => {
  const form = { zahlung: null, paidBy: '', payout: null } as unknown as BelegForm;
  applyZahlung(form, 'andere', 'Kim');
  assert.deepEqual([form.payout, form.paidBy], [true, '']);
  form.paidBy = 'Sam';
  applyZahlung(form, 'andere', 'Kim');
  assert.equal(form.paidBy, 'Sam', 'a typed name stays');
  applyZahlung(form, 'ich', 'Kim');
  assert.deepEqual([form.payout, form.paidBy], [true, 'Kim']);
  applyZahlung(form, 'sparbuch', 'Kim');
  assert.deepEqual([form.payout, form.paidBy], [true, 'Sparbuch']);
  applyZahlung(form, 'andere', 'Kim');
  assert.equal(form.paidBy, '', 'neither the own name nor the savings book stay');
  applyZahlung(form, 'stamm', 'Kim');
  assert.deepEqual([form.payout, form.paidBy], [false, '']);

  // Read back from a stored receipt
  assert.equal(zahlungOf({ payout: false, paidBy: 'Kim' }, isKim), 'stamm');
  assert.equal(zahlungOf({ payout: true, paidBy: 'Kim' }, isKim), 'ich');
  assert.equal(zahlungOf({ payout: true, paidBy: 'Sam' }, isKim), 'andere');
  assert.equal(zahlungOf({ payout: true, paidBy: 'Sparbuch' }, isKim), 'sparbuch');
});
