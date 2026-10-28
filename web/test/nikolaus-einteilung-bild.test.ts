import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildEinteilungBild } from '../src/lib/nikolausEinteilungBild';

describe('buildEinteilungBild', () => {
  test('lists the posts per team in role order, open posts and the kitchen sorted', () => {
    const names: Record<string, string> = { a: 'Anna', b: 'Ben', c: 'Cem', d: 'Dora' };
    const days = buildEinteilungBild(
      [{ date: '2026-12-05', teams: ['A', 'B'], familyTags: null }],
      [
        { personId: 'b', date: '2026-12-05', team: 'A', role: 'Fahrer*in', fixed: false },
        { personId: 'a', date: '2026-12-05', team: 'A', role: 'Nikolaus', fixed: true },
        { personId: 'd', date: '2026-12-05', team: 'Küche', role: 'Küche', fixed: false },
        { personId: 'c', date: '2026-12-05', team: 'Küche', role: 'Küche', fixed: false },
        { personId: 'c', date: '2026-12-06', team: 'A', role: 'Nikolaus', fixed: false },
      ],
      (id) => names[id],
      () => '#000',
      (date) => `Tag ${date}`
    );
    assert.equal(days.length, 1);
    assert.equal(days[0].label, 'Tag 2026-12-05');
    assert.deepEqual(days[0].teams[0].posts, [
      { role: 'Nikolaus', name: 'Anna' },
      { role: 'Krampus', name: null },
      { role: 'Fahrer*in', name: 'Ben' },
      { role: 'Engerl', name: null },
    ]);
    assert.ok(days[0].teams[1].posts.every((post) => post.name === null));
    assert.deepEqual(days[0].kitchen, ['Cem', 'Dora']);
  });
});
