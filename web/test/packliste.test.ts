import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packlisteReport } from '../src/lib/packlisteRows';

test('Packliste preserves order and long rows with a blank check column', () => {
  const items = ['Schlafsack', 'Ein langer Gegenstand '.repeat(12)];
  const report = packlisteReport({
    id: '1',
    title: 'Sommerlager',
    stufen: [],
    start: '2027-08-01',
    end: '2027-08-08',
    packingList: items,
  });
  assert.deepEqual(
    report.sections[0]?.rows,
    items.map((item) => ['', item])
  );
  assert.equal(report.sections[0]?.handwriting?.rowHeight, 8);
  assert.equal(report.fileName, 'Packliste Sommerlager.pdf');
});
