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

test('an entry of its own needs a name and at most one who packs it', () => {
  assert.deepEqual(validatePackEintrag({ name: '  Gas   kocher ' }), {
    name: 'Gas kocher',
    zustaendigId: null,
    zustaendigText: '',
  });
  assert.deepEqual(validatePackEintrag({ name: 'Zelt', zustaendigText: ' Ben ' }), {
    name: 'Zelt',
    zustaendigId: null,
    zustaendigText: 'Ben',
  });
  assert.deepEqual(validatePackEintrag({ name: 'Zelt', zustaendigId: 4 }), {
    name: 'Zelt',
    zustaendigId: 4,
    zustaendigText: '',
  });
  assert.deepEqual(
    fields(() => validatePackEintrag(null)),
    { name: 'Bitte eintragen, was eingepackt werden soll, z. B. „Gaskocher“.' }
  );
  assert.deepEqual(
    fields(() =>
      validatePackEintrag({ name: 'x'.repeat(101), zustaendigId: 0, zustaendigText: 'y' })
    ),
    { name: 'Höchstens 100 Zeichen.', zustaendigId: 'Bitte aus der Liste wählen.' }
  );
  assert.deepEqual(
    fields(() => validatePackEintrag({ name: 'Zelt', zustaendigId: 3, zustaendigText: 'Ben' })),
    { zustaendigText: 'Entweder ein Mitglied oder einen Namen.' }
  );
  assert.deepEqual(
    fields(() => validatePackEintrag({ name: 'Zelt', zustaendigText: 'z'.repeat(101) })),
    { zustaendigText: 'Höchstens 100 Zeichen.' }
  );
});

test('a change keeps only the fields that were sent', () => {
  assert.deepEqual(validatePackAenderung({ etag: '"1"', gepackt: true }), { gepackt: true });
  assert.deepEqual(validatePackAenderung({ zustaendigId: 7 }), {
    zustaendig: { zustaendigId: 7, zustaendigText: '' },
  });
  // Sending one of the two fields sets who packs it, an empty name takes it away
  assert.deepEqual(validatePackAenderung({ zustaendigText: '' }), {
    zustaendig: { zustaendigId: null, zustaendigText: '' },
  });
  assert.deepEqual(validatePackAenderung({ gepackt: false, zustaendigId: null }), {
    gepackt: false,
    zustaendig: { zustaendigId: null, zustaendigText: '' },
  });
  assert.deepEqual(
    fields(() => validatePackAenderung({ etag: '"1"' })),
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
    fields(() => validatePackAenderung({ zustaendigId: 1.5 })),
    { zustaendigId: 'Bitte aus der Liste wählen.' }
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
