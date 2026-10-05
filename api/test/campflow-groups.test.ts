import assert from 'node:assert/strict';
import test from 'node:test';
import { eventGroupNames, mapGroupToStufe, stufenFromGroups } from '../lib/campflow-groups';

test('CampFlow group names map to Stufen regardless of emoji, gender star and case', () => {
  assert.equal(mapGroupToStufe('🟠 Wölfling'), 'Wölflinge');
  assert.equal(mapGroupToStufe('  WÖS  '), 'Wölflinge');
  assert.equal(mapGroupToStufe('🔵 Jupfis'), 'Jungpfadfinder');
  assert.equal(mapGroupToStufe('Pfadfinder*innen'), 'Pfadfinder');
  assert.equal(mapGroupToStufe('🔴 Rover'), 'Rover');
  assert.equal(mapGroupToStufe('Leiter*innen'), undefined);
});

test('Stufen of several groups are unique and in their usual order', () => {
  assert.deepEqual(stufenFromGroups(['Rover', 'Wölflinge', 'wölfling', 42, 'Küche']), [
    'Wölflinge',
    'Rover',
  ]);
  assert.deepEqual(stufenFromGroups([]), []);
});

test('group names of an event are read from names and objects', () => {
  assert.deepEqual(
    eventGroupNames({
      groups: [{ id: 'g1', name: '🟢 Pfadis' }, { id: 'g2' }],
      group_names: ['Rover', 3],
      title: 'Sola',
    }),
    ['🟢 Pfadis', 'Rover']
  );
  assert.deepEqual(eventGroupNames({ groups: 'nope' }), []);
});
