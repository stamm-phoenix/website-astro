import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NIKOLAUS_CONTROL_MODULE,
  STAFF_MODULES,
  STAFF_MODULE_SECTIONS,
  staffModuleOf,
  staffPage,
} from '../src/lib/staffModules';
import { searchStaffModules, yourStaffModules } from '../src/lib/staffSearch';

const titles = (query: string): string[] =>
  searchStaffModules(query, STAFF_MODULE_SECTIONS).flatMap((group) =>
    group.modules.map((module) => module.title)
  );

test('an empty search keeps every group', () => {
  assert.equal(searchStaffModules('  ', STAFF_MODULE_SECTIONS), STAFF_MODULE_SECTIONS);
});

test('the search finds modules by title, other words and without umlauts', () => {
  assert.deepEqual(titles('beleg'), ['Belege', 'Eigenbeleg']);
  assert.ok(titles('kassenzettel').includes('Belege'));
  assert.deepEqual(titles('kasse').slice(0, 3).sort(), ['Abrechnung', 'Belege', 'Eigenbeleg']);
  assert.ok(titles('rusthaus').includes('Sammelbestellungen'));
  assert.deepEqual(titles('gibt es nicht'), []);
});

test('the best match comes first, also across the groups', () => {
  assert.equal(titles('fo')[0], 'Fotos');
  assert.equal(titles('blog')[0], 'Blog');
  assert.equal(titles('nikolaus').length, 0);
});

test('your areas are the favorites first, then the recent ones, without repeats', () => {
  const modules = [...STAFF_MODULES, NIKOLAUS_CONTROL_MODULE];
  const picked = yourStaffModules(
    ['/leitendenbereich/belege'],
    ['/leitendenbereich/fotos', '/leitendenbereich/belege', '/weg', '/leitendenbereich/blog'],
    modules,
    2
  );
  assert.deepEqual(
    picked.map((module) => module.title),
    ['Belege', 'Fotos']
  );
});

test('a detail page belongs to the module above it', () => {
  assert.equal(staffModuleOf(staffPage('/leitendenbereich/blog/beitrag'))?.title, 'Blog');
  assert.equal(staffModuleOf(staffPage('/leitendenbereich/aktionen/fahrten'))?.title, 'Fahrten');
  assert.equal(staffModuleOf(staffPage('/leitendenbereich')), null);
  assert.equal(staffModuleOf(staffPage('/leitendenbereich/wieder-angemeldet')), null);
});
