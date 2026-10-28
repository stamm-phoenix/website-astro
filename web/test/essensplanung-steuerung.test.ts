import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeAudit,
  fromEinstellungenForm,
  fromZutatForm,
  parseDecimal,
  toEinstellungenForm,
  toZutatForm,
} from '../src/lib/essensplanungSteuerung.ts';
import type { EssenEinstellungen, EssenZutat } from '../src/lib/types.ts';

const EINSTELLUNGEN: EssenEinstellungen = {
  anlegenExtern: true,
  whitelist: ['dpsg-bezirk.de', 'kueche@example.org'],
  aufbewahrungMonate: 12,
  wartung: false,
  vorlageGruppen: [{ name: 'Wö', faktor: 0.7 }],
  vorlageMahlzeiten: ['Frühstück'],
};

const HONIG: EssenZutat = {
  id: 7,
  etag: '"1"',
  name: 'Honig',
  kategorieId: 3,
  einheitenart: 'masse',
  abtropfgewicht: false,
  lebensmittel: true,
  vegetarisch: true,
  vegan: false,
  merkmaleGeprueft: false,
  hinweis: '',
  grammProTl: 7.5,
  grammProEl: null,
  grammProStueck: null,
  allergene: [],
  geaendertAm: '2026-10-28T12:00:00.000Z',
  geaendertVon: 'Startdaten',
};

test('settings survive the form, with German decimals and one entry per line', () => {
  const form = toEinstellungenForm(EINSTELLUNGEN);
  assert.equal(form.whitelist, 'dpsg-bezirk.de\nkueche@example.org');
  assert.equal(form.vorlageGruppen[0].faktor, '0,7');
  assert.deepEqual(fromEinstellungenForm(form), EINSTELLUNGEN);
  form.whitelist = 'a.de, b.de\n\n';
  assert.deepEqual(fromEinstellungenForm(form).whitelist, ['a.de', 'b.de']);
});

test('numbers that are not numbers stay invalid for the API', () => {
  assert.equal(parseDecimal('1,25'), 1.25);
  assert.equal(Number.isNaN(parseDecimal('zwölf')), true);
  assert.equal(Number.isNaN(parseDecimal('')), true);
});

test('the diet of an ingredient maps to vegetarisch and vegan', () => {
  const form = toZutatForm(HONIG);
  assert.equal(form.ernaehrung, 'vegetarisch');
  assert.equal(form.grammProTl, '7,5');
  const diet = (patch: Partial<typeof form>) => {
    const { vegetarisch, vegan } = fromZutatForm({ ...form, ...patch });
    return { vegetarisch, vegan };
  };
  assert.deepEqual(diet({}), { vegetarisch: true, vegan: false });
  assert.equal(fromZutatForm(form).grammProTl, 7.5);
  assert.deepEqual(diet({ ernaehrung: 'unbekannt' }), { vegetarisch: null, vegan: null });
  assert.deepEqual(diet({ ernaehrung: 'nein' }), { vegetarisch: false, vegan: false });
  // Things that are not eaten carry no allergens; drained weight only for g/kg
  const spuelmittel = fromZutatForm({
    ...form,
    lebensmittel: false,
    allergene: [1],
    einheitenart: 'stueck',
    abtropfgewicht: true,
  });
  assert.deepEqual(spuelmittel.allergene, []);
  assert.equal(spuelmittel.abtropfgewicht, false);
});

test('the log names what changed', () => {
  const entry = (action: string, details: Record<string, unknown>) => ({
    id: 1,
    at: '2026-10-28T12:00:00.000Z',
    actor: 'admin@example.test',
    action,
    details,
  });
  assert.equal(
    describeAudit(
      entry('einstellungen', {
        changes: {
          anlegenExtern: { from: false, to: true },
          aufbewahrungMonate: { from: 12, to: 6 },
          whitelist: true,
        },
      })
    ),
    'Anlegen durch Externe an, Aufbewahrung: 6 Monate, Erlaubte Adressen geändert'
  );
  assert.equal(
    describeAudit(entry('zutat-geaendert', { name: 'Honig', vorher: 'Hong' })),
    'Zutat geändert: Honig (vorher: Hong)'
  );
});
