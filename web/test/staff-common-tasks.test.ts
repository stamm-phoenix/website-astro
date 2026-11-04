import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commonTaskModules } from '../src/lib/staffCommonTasks';
import { STAFF_MODULES } from '../src/lib/staffModules';

const paths = (counts: Record<string, number>) =>
  commonTaskModules(STAFF_MODULES, counts).map((m) => m.href);
test('insufficient visits keep the established fallback', () => {
  assert.deepEqual(paths({ '/leitendenbereich/fotos': 19 }), paths({}));
});
test('popular modules come first, limited to four, with stable ties', () => {
  assert.deepEqual(
    paths({
      '/leitendenbereich/fotos': 30,
      '/leitendenbereich/aufgaben': 20,
      '/leitendenbereich/belege': 10,
      '/leitendenbereich/protokolle': 8,
      '/leitendenbereich/aktionen': 5,
    }),
    [
      '/leitendenbereich/fotos',
      '/leitendenbereich/aufgaben',
      '/leitendenbereich/belege',
      '/leitendenbereich/protokolle',
    ]
  );
});
test('unavailable or seasonal modules do not affect selection or the threshold', () => {
  const allowed = STAFF_MODULES.filter((m) => m.href === '/leitendenbereich/aufgaben');
  assert.deepEqual(
    commonTaskModules(allowed, { '/leitendenbereich/fotos': 100 }).map((m) => m.href),
    ['/leitendenbereich/aufgaben']
  );
});

test('equal counts have a deterministic order and invalid counts are ignored', () => {
  assert.deepEqual(
    paths({
      '/leitendenbereich/fotos': 20,
      '/leitendenbereich/belege': 20,
      '/leitendenbereich/aufgaben': -1,
    }),
    ['/leitendenbereich/belege', '/leitendenbereich/fotos']
  );
});
