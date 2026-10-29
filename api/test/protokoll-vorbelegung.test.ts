import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aktion } from '../lib/aktionen-list';
import { neuerInhalt } from '../lib/protokoll-editor-model';
import { aktionenTexte, naechsteSitzungAus, stufenberichte } from '../lib/protokoll-vorbelegung';
import type { BerichtGruppenstunde } from '../lib/protokoll-vorbelegung';

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

function aktion(extra: Partial<Aktion>): Aktion {
  return { id: '1', stufen: [], title: 'Aktion', start: '2026-10-01', end: '', ...extra };
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

test('Aktionen split into Reflexion (over since the last minutes) and Planung (still to come)', () => {
  const texte = aktionenTexte(
    [
      aktion({
        id: '1',
        title: 'Zeltlager',
        start: '2026-10-10',
        end: '2026-10-12',
        stufen: ['Rover'],
      }),
      aktion({ id: '2', title: 'Zu alt', start: '2026-08-01' }),
      aktion({ id: '3', title: 'Nur Leitende', start: '2026-11-01', stufen: ['Leitende'] }),
      aktion({ id: '4', title: 'Adventsbasar', start: '2026-12-05' }),
      aktion({ id: '5', title: 'Weit weg', start: '2027-06-01' }),
      aktion({ id: '6', title: 'Heute', start: '2026-10-14' }),
    ],
    { nach: '2026-09-30', date: '2026-10-14', bis: '2027-01-12' }
  );
  assert.equal(
    texte['Reflexion'],
    'Aktionen seit der letzten Sitzung:\n- 10.–12.10.2026: Zeltlager (Rover)\n- 14.10.2026: Heute'
  );
  assert.equal(texte['Planung'], 'Anstehende Aktionen:\n- 05.12.2026: Adventsbasar');
});

test('the next meeting presets time and place of the previous minutes, not the date', () => {
  const content = JSON.stringify({
    naechsteSitzung: { datum: '2026-10-14', uhrzeit: '19:30', ort: 'Pfarrheim' },
  });
  assert.deepEqual(naechsteSitzungAus(content), { uhrzeit: '19:30', ort: 'Pfarrheim' });
  assert.deepEqual(naechsteSitzungAus('kaputt'), { uhrzeit: '', ort: '' });
  let n = 0;
  const inhalt = neuerInhalt(
    () => `id${n++}`,
    {},
    {
      texte: { Wölflinge: '- 07.10.: 8 Kinder', Planung: 'Anstehende Aktionen:' },
      naechsteSitzung: { uhrzeit: '19:30', ort: 'Pfarrheim' },
    }
  );
  assert.deepEqual(inhalt.naechsteSitzung, { datum: '', uhrzeit: '19:30', ort: 'Pfarrheim' });
  assert.deepEqual(inhalt.punkte[0].unterpunkte.map((p) => [p.titel, p.text]).slice(0, 2), [
    ['Wölflinge', '- 07.10.: 8 Kinder'],
    ['Jungpfadfinder', ''],
  ]);
  assert.equal(inhalt.punkte[2].text, 'Anstehende Aktionen:');
});
