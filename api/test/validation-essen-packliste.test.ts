import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PACK_NAME,
  MAX_PACK_SCHLUESSEL,
  packlisteSchluessel,
} from '../lib/essen-packliste-model';
import {
  validatePackAenderung,
  validatePackEintrag,
  validateWerkzeugAenderung,
  validateZuteilungAenderung,
} from '../lib/essen-packliste-validation';
import { fields } from './fixtures/essen-fields';

test('tools are merged by their trimmed name in lower case', () => {
  assert.equal(packlisteSchluessel('  Großer   Topf '), 'großer topf');
  assert.equal(packlisteSchluessel('GROSSER TOPF'), 'grosser topf');
  assert.equal(packlisteSchluessel('Pürierstab'), packlisteSchluessel('pürierstab'));
});

test('a merged name may outgrow its name but fits the stored column', () => {
  const name = 'A'.repeat(99) + 'İ';
  assert.equal(validateWerkzeugAenderung({ werkzeug: name, gepackt: true }).werkzeug, name);
  assert.equal(name.length, MAX_PACK_NAME);
  const schluessel = packlisteSchluessel(name);
  assert.equal(schluessel.length, 101);
  assert.ok(schluessel.length <= MAX_PACK_SCHLUESSEL);
  // Every character of the longest name at its longest still fits
  assert.ok(packlisteSchluessel('İ'.repeat(MAX_PACK_NAME)).length <= MAX_PACK_SCHLUESSEL);
});

test('an entry of its own needs a name and may have several who pack it', () => {
  assert.deepEqual(validatePackEintrag({ name: '  Gas   kocher ' }), {
    name: 'Gas kocher',
    mitglieder: [],
    namen: [],
  });
  // The same member or name (any case) counts once; empty names are dropped
  assert.deepEqual(
    validatePackEintrag({
      name: 'Kochschürze',
      mitglieder: [4, 7, 4],
      namen: [' Ben ', 'ben', '', 'Sam'],
    }),
    { name: 'Kochschürze', mitglieder: [4, 7], namen: ['Ben', 'Sam'] }
  );
  assert.deepEqual(
    fields(() => validatePackEintrag(null)),
    { name: 'Bitte eintragen, was eingepackt werden soll, z. B. „Gaskocher“.' }
  );
  assert.deepEqual(
    fields(() => validatePackEintrag({ name: 'x'.repeat(101), mitglieder: [0] })),
    { name: 'Höchstens 100 Zeichen.', mitglieder: 'Bitte aus der Liste wählen.' }
  );
  assert.deepEqual(
    fields(() => validatePackEintrag({ name: 'Zelt', mitglieder: 3 })),
    { mitglieder: 'Bitte aus der Liste wählen.' }
  );
  assert.deepEqual(
    fields(() => validatePackEintrag({ name: 'Zelt', namen: ['z'.repeat(101)] })),
    { namen: 'Höchstens 100 Zeichen.' }
  );
  assert.deepEqual(
    fields(() =>
      validatePackEintrag({ name: 'Zelt', namen: Array.from({ length: 51 }, (_, i) => `P${i}`) })
    ),
    { namen: 'Höchstens 50 Namen.' }
  );
});

test('a change keeps only the fields that were sent', () => {
  assert.deepEqual(validatePackAenderung({ etag: '"1"', gepackt: true }), { gepackt: true });
  assert.deepEqual(validatePackAenderung({ mitglieder: [7] }), {
    hinzu: { mitglieder: [7], namen: [] },
  });
  assert.deepEqual(validatePackAenderung({ namen: ['Rover'], weg: [3, 3] }), {
    hinzu: { mitglieder: [], namen: ['Rover'] },
    weg: [3],
  });
  assert.deepEqual(validatePackAenderung({ gepackt: false, weg: [2] }), {
    gepackt: false,
    weg: [2],
  });
  assert.deepEqual(
    fields(() => validatePackAenderung({ etag: '"1"', mitglieder: [], namen: [' '] })),
    { gepackt: 'Es gibt nichts zu speichern.' }
  );
  // A body that is no object names the same in German, not an inner field
  for (const body of [null, [], 'x']) {
    assert.deepEqual(
      fields(() => validatePackAenderung(body)),
      { gepackt: 'Es gibt nichts zu speichern.' }
    );
  }
  assert.deepEqual(
    fields(() => validatePackAenderung({ gepackt: 'ja' })),
    { gepackt: 'Bitte ankreuzen oder nicht.' }
  );
  assert.deepEqual(
    fields(() => validatePackAenderung({ weg: [1.5] })),
    { weg: 'Bitte aus der Liste wählen.' }
  );
});

test('a share of one person is packed or not', () => {
  assert.deepEqual(validateZuteilungAenderung({ etag: '"1"', gepackt: true }), { gepackt: true });
  assert.deepEqual(
    fields(() => validateZuteilungAenderung({ etag: '"1"' })),
    { gepackt: 'Bitte ankreuzen oder nicht.' }
  );
});

test('a tool is named by its name, with the changed fields', () => {
  assert.deepEqual(validateWerkzeugAenderung({ werkzeug: ' Pürierstab ', gepackt: true }), {
    werkzeug: 'Pürierstab',
    gepackt: true,
  });
  assert.deepEqual(
    fields(() => validateWerkzeugAenderung({ werkzeug: '' })),
    { werkzeug: 'Bitte ein Werkzeug wählen.', gepackt: 'Es gibt nichts zu speichern.' }
  );
});
