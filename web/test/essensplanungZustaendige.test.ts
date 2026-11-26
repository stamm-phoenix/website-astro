import assert from 'node:assert/strict';
import test from 'node:test';
import { zustaendigAus } from '../src/lib/essensplanungPlan.ts';
import { zustaendigeJeGericht } from '../src/lib/essensplanungZustaendige.ts';
import type { Einplanung, PlanungMitglied, PlanungTag } from '../../api/lib/essen-planung-model.ts';

const einplanung = (
  gerichtId: number,
  zustaendig: string,
  zustaendigId: number | null = null
): Einplanung => ({
  id: 0,
  etag: '',
  gerichtId,
  position: 1,
  faktor: 1,
  zustaendigId,
  zustaendig,
  status: 'offen',
  verbrauch: [],
});

const tag = (datum: string, einplanungen: Einplanung[]): PlanungTag => ({
  id: 0,
  etag: '',
  datum,
  nummer: 1,
  mahlzeiten: [
    { id: 0, etag: '', position: 1, kennung: '1_1', name: 'Mittag', einplanungen, ohneGruppen: [] },
  ],
});

const mitglied = (id: number, name: string): PlanungMitglied => ({
  id,
  etag: '',
  name,
  rolle: 'bearbeiten',
  email: null,
  entzogen: false,
  ich: false,
});

test('gathers the responsible persons of each dish once, in the order of the plan', () => {
  const ergebnis = zustaendigeJeGericht({
    ichId: null,
    mitglieder: [],
    tage: [
      tag('2026-07-02', [einplanung(1, 'Lena'), einplanung(1, 'nico  welles')]),
      tag('2026-07-01', [einplanung(1, 'Nico Welles'), einplanung(2, ''), einplanung(1, 'Lena')]),
    ],
  });
  assert.deepEqual(ergebnis.get(1), { namen: ['Nico Welles', 'Lena'], ich: false });
  assert.equal(ergebnis.has(2), false);
});

test('marks dishes of the viewer, as member or as their name typed freely', () => {
  const ergebnis = zustaendigeJeGericht({
    ichId: 7,
    mitglieder: [mitglied(7, 'Nico Welles'), mitglied(8, 'Lena')],
    tage: [
      tag('2026-07-01', [
        einplanung(1, 'Nico Welles', 7),
        einplanung(2, 'nico welles'),
        einplanung(3, 'Lena', 8),
      ]),
    ],
  });
  assert.equal(ergebnis.get(1)?.ich, true);
  assert.equal(ergebnis.get(2)?.ich, true);
  assert.equal(ergebnis.get(3)?.ich, false);
});

test('the plan and the mark compare names alike, also with doubled spaces', () => {
  const mitglieder = [mitglied(7, 'Nico  Welles')];
  assert.deepEqual(zustaendigAus('nico welles', mitglieder), {
    zustaendigId: 7,
    zustaendigText: '',
  });
});
