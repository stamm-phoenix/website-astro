import assert from 'node:assert/strict';
import test from 'node:test';
import { neuerInhalt, stufenberichte } from '../lib/protokoll-editor-model';
import type { BerichtGruppenstunde } from '../lib/protokoll-editor-model';

function stunde(extra: Partial<BerichtGruppenstunde>): BerichtGruppenstunde {
  return {
    stufe: 'Wölflinge',
    date: '2026-10-07',
    members: 8,
    excused: 0,
    guests: 0,
    notes: '',
    cancelled: false,
    ...extra,
  };
}

test('a Stufenbericht lists the Gruppenstunden oldest first with counts and what was done', () => {
  const berichte = stufenberichte([
    stunde({ date: '2026-10-14', members: 1, excused: 2, guests: 1, notes: 'Basteln' }),
    stunde({ date: '2026-10-07', notes: 'Lagerfeuer\naufbauen' }),
    stunde({ date: '2026-10-21', cancelled: true }),
    stunde({ stufe: 'Rover', date: '2026-10-09', members: 4, guests: 3 }),
  ]);
  assert.equal(
    berichte['Wölflinge'],
    [
      '- 07.10.: 8 Kinder. Lagerfeuer aufbauen',
      '- 14.10.: ein Kind (2 entschuldigt, ein Gast). Basteln',
      '- 21.10.: fiel aus',
    ].join('\n')
  );
  assert.equal(berichte['Rover'], '- 09.10.: 4 Kinder (3 Gäste)');
  assert.equal(berichte['Pfadfinder'], undefined);
});

test('new minutes prefill only the sub-items of the matching Stufe', () => {
  let n = 0;
  const inhalt = neuerInhalt(() => `id${n++}`, {}, { Wölflinge: '- 07.10.: 8 Kinder' });
  const stufen = inhalt.punkte[0].unterpunkte;
  assert.deepEqual(
    stufen.map((p) => [p.titel, p.text]),
    [
      ['Wölflinge', '- 07.10.: 8 Kinder'],
      ['Jungpfadfinder', ''],
      ['Pfadfinder', ''],
      ['Rover', ''],
      ['StaVos', ''],
    ]
  );
});
