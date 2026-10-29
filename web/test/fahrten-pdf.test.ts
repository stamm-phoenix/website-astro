import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fahrtenPdfReport } from '../src/lib/fahrtenPdf';
import type { FahrtPerson, FahrtPlan } from '../src/lib/fahrtenPlan';

function person(id: string, telefon = ''): FahrtPerson {
  return { id, name: id, nachname: id, gruppe: '🔴 Rover', plaetze: { hin: 0, rueck: 0 }, telefon };
}

const hin: FahrtPlan = {
  fahrt: 'hin',
  autos: [
    { fahrer: person('Fahrerin', '0176 1 (Mobil)'), plaetze: 4, mitfahrende: [person('Kind')] },
    { fahrer: person('Fahrer'), plaetze: 2, mitfahrende: [] },
  ],
  ohnePlatz: [person('Ohne')],
  entfernt: [],
};
const rueck: FahrtPlan = { fahrt: 'rueck', autos: [], ohnePlatz: [], entfernt: [person('Weg')] };

describe('fahrtenPdfReport', () => {
  const report = fahrtenPdfReport({
    title: 'Hike',
    range: '03.10.2026',
    plans: [hin, rueck],
  });

  test('has a section per car with the driver, the phone and the passengers', () => {
    const car = report.sections[1];
    assert.equal(car.heading, 'Hinfahrt – Auto 1: Fahrerin');
    assert.deepEqual(car.lines, ['Telefon: 0176 1 (Mobil) · 2 von 4 Plätzen belegt · 2 frei']);
    assert.deepEqual(car.columns, ['Name', 'Gruppe', 'Telefon']);
    assert.deepEqual(car.rows, [['Kind', 'Rover', '']]);

    const alone = report.sections[2];
    assert.deepEqual(alone.lines, ['1 von 2 Plätzen belegt · 1 frei', 'Fährt allein.']);
    assert.equal(alone.rows, undefined);
  });

  test('lists who has no seat and starts each direction on a new page', () => {
    assert.deepEqual(
      report.sections.map((section) => [section.heading, section.newPage ?? false]),
      [
        ['Hinfahrt', false],
        ['Hinfahrt – Auto 1: Fahrerin', false],
        ['Hinfahrt – Auto 2: Fahrer', false],
        ['Hinfahrt – Ohne Platz (1)', false],
        ['Rückfahrt', true],
        ['Rückfahrt – Nicht eingeplant (1)', false],
      ]
    );
    assert.deepEqual(report.sections[0].lines, ['2 Autos · 1 Mitfahrende · 1 ohne Platz']);
    assert.deepEqual(report.sections[4].lines, ['Niemand hat Plätze angeboten.']);
    assert.equal(report.fileName, 'Fahrten Hike.pdf');
  });
});
