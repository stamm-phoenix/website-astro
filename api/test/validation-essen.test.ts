import assert from 'node:assert/strict';
import test from 'node:test';
import { readGruppen, readStrings, validateEssenEinstellungen } from '../lib/essen-validation';
import { fields } from './fixtures/essen-fields';

const EINSTELLUNGEN = {
  anlegenExtern: false,
  whitelist: [],
  aufbewahrungMonate: 24,
  wartung: false,
  vorlageGruppen: [{ name: 'Wölflinge', faktor: 0.5 }],
  vorlageMahlzeiten: ['Frühstück'],
};

function einstellungen(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...EINSTELLUNGEN, ...patch };
}

test('the lenient readers of stored JSON keep what they can read', () => {
  assert.deepEqual(readStrings('["a", 3, null, "b"]'), ['a', 'b']);
  assert.deepEqual(readStrings('{"a":1}'), []);
  assert.deepEqual(readStrings('kein json'), []);
  assert.deepEqual(
    readGruppen(
      '[{"name":"Wö","faktor":0.5,"x":1},{"name":"x"},{"faktor":1},null,7,{"name":"Ju","faktor":0}]'
    ),
    [
      { name: 'Wö', faktor: 0.5 },
      { name: 'Ju', faktor: 0 },
    ]
  );
  assert.deepEqual(readGruppen('"text"'), []);
  assert.deepEqual(readGruppen('kein json'), []);
});

test('settings: a valid body is normalized', () => {
  assert.deepEqual(validateEssenEinstellungen(EINSTELLUNGEN), EINSTELLUNGEN);
  const normalized = validateEssenEinstellungen(
    einstellungen({
      anlegenExtern: true,
      whitelist: [
        ' @DPSG-Bezirk.de ',
        'Jemand@Example.org',
        '',
        '  ',
        7,
        null,
        '@',
        'dpsg-bezirk.de',
      ],
      aufbewahrungMonate: 120,
      vorlageGruppen: [
        { name: '  Wö   Meute ', faktor: 0.705 },
        { name: 'Pfadis', faktor: 5 },
      ],
      vorlageMahlzeiten: ['  Abend   essen ', 'Mittag'],
    })
  );
  assert.deepEqual(normalized, {
    anlegenExtern: true,
    whitelist: ['dpsg-bezirk.de', 'jemand@example.org'],
    aufbewahrungMonate: 120,
    wartung: false,
    vorlageGruppen: [
      { name: 'Wö Meute', faktor: 0.71 },
      { name: 'Pfadis', faktor: 5 },
    ],
    vorlageMahlzeiten: ['Abend essen', 'Mittag'],
  });
});

test('settings: something that is no object reports every field', () => {
  const expected = {
    anlegenExtern: 'Bitte ja oder nein wählen.',
    wartung: 'Bitte ja oder nein wählen.',
    whitelist: 'Bitte eine Liste angeben.',
    aufbewahrungMonate: 'Bitte eine ganze Zahl von 1 bis 120 Monaten eintragen.',
    vorlageGruppen: 'Bitte mindestens eine Gruppe eintragen.',
    vorlageMahlzeiten: 'Bitte mindestens eine Mahlzeit eintragen.',
  };
  for (const body of [undefined, null, [], 'text', 5]) {
    assert.deepEqual(
      fields(() => validateEssenEinstellungen(body)),
      expected
    );
  }
});

test('settings: switches, retention and whitelist rules', () => {
  assert.deepEqual(
    fields(() =>
      validateEssenEinstellungen(
        einstellungen({
          anlegenExtern: 'ja',
          wartung: 1,
          aufbewahrungMonate: 1.5,
          whitelist: ['gut@example.org', 'kein eintrag', 'a@b', 'x.de.'],
        })
      )
    ),
    {
      anlegenExtern: 'Bitte ja oder nein wählen.',
      wartung: 'Bitte ja oder nein wählen.',
      aufbewahrungMonate: 'Bitte eine ganze Zahl von 1 bis 120 Monaten eintragen.',
      'whitelist.1':
        'Bitte eine Mailadresse (name@beispiel.de) oder eine Domain (beispiel.de) eintragen.',
      'whitelist.2':
        'Bitte eine Mailadresse (name@beispiel.de) oder eine Domain (beispiel.de) eintragen.',
      'whitelist.3':
        'Bitte eine Mailadresse (name@beispiel.de) oder eine Domain (beispiel.de) eintragen.',
    }
  );
  for (const monate of [0, 121, '24', null, Number.NaN, Infinity]) {
    assert.deepEqual(
      Object.keys(
        fields(() => validateEssenEinstellungen(einstellungen({ aufbewahrungMonate: monate })))
      ),
      ['aufbewahrungMonate']
    );
  }
  assert.equal(
    validateEssenEinstellungen(einstellungen({ aufbewahrungMonate: 1 })).aufbewahrungMonate,
    1
  );
  assert.deepEqual(
    fields(() => validateEssenEinstellungen(einstellungen({ whitelist: 'a.de' }))),
    {
      whitelist: 'Bitte eine Liste angeben.',
    }
  );
});

test('settings: Gruppen need a name and a factor and no duplicates', () => {
  assert.deepEqual(
    fields(() =>
      validateEssenEinstellungen(
        einstellungen({
          vorlageGruppen: [
            { name: 'Wö', faktor: 0.001 },
            { name: 'wö', faktor: 1 },
            { name: 'x'.repeat(51), faktor: 6 },
            { faktor: 'viel' },
            'kein objekt',
            { name: 'Ok', faktor: Number.NaN },
          ],
        })
      )
    ),
    {
      'vorlageGruppen.0.faktor': 'Bitte einen Faktor von 0,01 bis 5 eintragen.',
      'vorlageGruppen.1.name': 'Diese Gruppe gibt es schon.',
      'vorlageGruppen.2.name': 'Höchstens 50 Zeichen.',
      'vorlageGruppen.2.faktor': 'Bitte einen Faktor von 0,01 bis 5 eintragen.',
      'vorlageGruppen.3.name': 'Bitte einen Namen eintragen.',
      'vorlageGruppen.3.faktor': 'Bitte einen Faktor von 0,01 bis 5 eintragen.',
      'vorlageGruppen.4.name': 'Bitte einen Namen eintragen.',
      'vorlageGruppen.4.faktor': 'Bitte einen Faktor von 0,01 bis 5 eintragen.',
      'vorlageGruppen.5.faktor': 'Bitte einen Faktor von 0,01 bis 5 eintragen.',
    }
  );
  assert.equal(
    validateEssenEinstellungen(
      einstellungen({ vorlageGruppen: [{ name: 'A', faktor: 0.004 + 0.006 }] })
    ).vorlageGruppen[0].faktor,
    0.01
  );
  assert.deepEqual(
    fields(() =>
      validateEssenEinstellungen(
        einstellungen({
          vorlageGruppen: [
            { name: 'Wö', faktor: 1 },
            { name: ' wö ', faktor: 1 },
            { name: 'WÖ', faktor: 1 },
          ],
        })
      )
    ),
    { 'vorlageGruppen.1.name': 'Diese Gruppe gibt es schon.' }
  );
  assert.deepEqual(
    fields(() => validateEssenEinstellungen(einstellungen({ vorlageGruppen: [] }))),
    { vorlageGruppen: 'Bitte mindestens eine Gruppe eintragen.' }
  );
  assert.deepEqual(
    fields(() => validateEssenEinstellungen(einstellungen({ vorlageGruppen: {} }))),
    { vorlageGruppen: 'Bitte mindestens eine Gruppe eintragen.' }
  );
});

test('settings: more than 20 entries report only the list', () => {
  const gruppen = Array.from({ length: 21 }, () => ({ name: '', faktor: 'x' }));
  assert.deepEqual(
    fields(() => validateEssenEinstellungen(einstellungen({ vorlageGruppen: gruppen }))),
    { vorlageGruppen: 'Höchstens 20 Gruppen.' }
  );
  const mahlzeiten = Array.from({ length: 21 }, () => '');
  assert.deepEqual(
    fields(() => validateEssenEinstellungen(einstellungen({ vorlageMahlzeiten: mahlzeiten }))),
    { vorlageMahlzeiten: 'Höchstens 20 Mahlzeiten.' }
  );
  const twenty = Array.from({ length: 20 }, (_, index) => `Mahlzeit ${index}`);
  assert.equal(
    validateEssenEinstellungen(einstellungen({ vorlageMahlzeiten: twenty })).vorlageMahlzeiten
      .length,
    20
  );
});

test('settings: Mahlzeiten are names without duplicates', () => {
  assert.deepEqual(
    fields(() =>
      validateEssenEinstellungen(
        einstellungen({ vorlageMahlzeiten: ['Frühstück', 'x'.repeat(51), 7, 'frühstück'] })
      )
    ),
    {
      'vorlageMahlzeiten.1': 'Höchstens 50 Zeichen.',
      'vorlageMahlzeiten.2': 'Bitte einen Namen eintragen.',
      'vorlageMahlzeiten.3': 'Diese Mahlzeit gibt es schon.',
    }
  );
  assert.deepEqual(
    fields(() => validateEssenEinstellungen(einstellungen({ vorlageMahlzeiten: [] }))),
    { vorlageMahlzeiten: 'Bitte mindestens eine Mahlzeit eintragen.' }
  );
  assert.deepEqual(
    fields(() => validateEssenEinstellungen(einstellungen({ vorlageMahlzeiten: 'Frühstück' }))),
    { vorlageMahlzeiten: 'Bitte mindestens eine Mahlzeit eintragen.' }
  );
});
