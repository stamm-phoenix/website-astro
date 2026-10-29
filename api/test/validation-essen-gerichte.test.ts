import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGericht } from '../lib/essen-gerichte-validation';
import type { GerichtInput } from '../lib/essen-gerichte-validation';
import { fields } from './fixtures/essen-fields';

const NAME_FEHLT = 'Bitte einen Namen eintragen, z. B. „Chili sin Carne“.';
const PERSONEN_UNGUELTIG = 'Bitte eine ganze Zahl ab 1 eintragen.';
const ADRESSE = 'Bitte eine Adresse wie https://beispiel.de eintragen.';

function neu(input: unknown): GerichtInput {
  return validateGericht(input, { neu: true });
}

function aendern(input: unknown): GerichtInput {
  return validateGericht(input, { neu: false });
}

function neuFehler(patch: Record<string, unknown>): Record<string, string> {
  return fields(() => neu({ name: 'A', personen: 1, ...patch }));
}

function aendernFehler(input: unknown): Record<string, string> {
  return fields(() => aendern(input));
}

test('Gericht: a new dish with name and people', () => {
  assert.deepEqual(neu({ name: 'Chili', personen: 12 }), { name: 'Chili', personen: 12 });
  assert.deepEqual(
    neu({
      name: '  Chili   sin  Carne ',
      personen: 2000,
      anleitung: '  Erst   kochen.\n ',
      notiz: ' Scharf ',
      links: [{ titel: ' Rezept  ', url: ' https://beispiel.de/chili ' }],
      werkzeuge: [' Topf ', 'Löffel'],
      unbekannt: 1,
    }),
    {
      name: 'Chili sin Carne',
      personen: 2000,
      anleitung: 'Erst   kochen.',
      notiz: 'Scharf',
      links: [{ titel: 'Rezept', url: 'https://beispiel.de/chili' }],
      werkzeuge: ['Topf', 'Löffel'],
    }
  );
});

test('Gericht: a new dish needs name and people, whatever the input is', () => {
  const expected = { name: NAME_FEHLT, personen: PERSONEN_UNGUELTIG };
  const inputs = [undefined, null, 'x', 5, [], {}, { name: '   ' }, { name: 4, personen: '4' }];
  for (const input of [...inputs, { name: null, personen: null }]) {
    assert.deepEqual(
      fields(() => neu(input)),
      expected
    );
  }
});

test('Gericht: the name has at most 150 characters', () => {
  assert.equal(neu({ name: 'a'.repeat(150), personen: 1 }).name?.length, 150);
  const zuLang = { name: 'Höchstens 150 Zeichen.' };
  assert.deepEqual(neuFehler({ name: 'a'.repeat(151) }), zuLang);
  assert.deepEqual(neuFehler({ name: 'ab '.repeat(80) }), { name: 'Höchstens 150 Zeichen.' });
  // The length is counted in UTF-16 units
  assert.deepEqual(neuFehler({ name: '😀'.repeat(76) }), zuLang);
});

test('Gericht: the number of people is a whole number from 1 to 2000', () => {
  assert.deepEqual(neu({ name: 'A', personen: 1 }), { name: 'A', personen: 1 });
  for (const personen of [0, -3, 1.5, '5', true, NaN, Infinity, {}, [4], null]) {
    assert.deepEqual(neuFehler({ personen }), { personen: PERSONEN_UNGUELTIG }, String(personen));
  }
  assert.deepEqual(neuFehler({ personen: 2001 }), { personen: 'Höchstens 2000 Personen.' });
  assert.deepEqual(neuFehler({ personen: 2000.5 }), { personen: PERSONEN_UNGUELTIG });
});

test('Gericht: anleitung and notiz are trimmed, other values are empty', () => {
  assert.deepEqual(neu({ name: 'A', personen: 1, anleitung: null, notiz: 5 }), {
    name: 'A',
    personen: 1,
    anleitung: '',
    notiz: '',
  });
  assert.equal(
    neu({ name: 'A', personen: 1, anleitung: 'a'.repeat(20_000) }).anleitung?.length,
    20_000
  );
  assert.equal(
    neu({ name: 'A', personen: 1, anleitung: ` ${'a'.repeat(20_000)} ` }).anleitung?.length,
    20_000
  );
  assert.deepEqual(neuFehler({ anleitung: 'a'.repeat(20_001) }), {
    anleitung: 'Höchstens 20.000 Zeichen.',
  });
  assert.equal(neu({ name: 'A', personen: 1, notiz: 'n'.repeat(1000) }).notiz?.length, 1000);
  assert.deepEqual(neuFehler({ notiz: 'n'.repeat(1001) }), { notiz: 'Höchstens 1000 Zeichen.' });
});

test('Gericht: a link needs an http or https address of at most 500 characters', () => {
  const links = (url: unknown): Record<string, string> =>
    neuFehler({ links: [{ titel: 'x', url }] });
  for (const url of [
    undefined,
    null,
    5,
    '',
    '  ',
    'beispiel.de',
    'ftp://beispiel.de',
    'javascript:1',
  ]) {
    assert.deepEqual(links(url), { 'links.0.url': ADRESSE }, String(url));
  }
  assert.deepEqual(neu({ name: 'A', personen: 1, links: [{ url: 'http://a.de' }] }).links, [
    { titel: '', url: 'http://a.de' },
  ]);
  const lang = `https://a.de/${'x'.repeat(487)}`;
  assert.equal(lang.length, 500);
  assert.equal(neu({ name: 'A', personen: 1, links: [{ url: lang }] }).links?.[0].url, lang);
  assert.deepEqual(links(`${lang}x`), { 'links.0.url': ADRESSE });
});

test('Gericht: the title of a link has at most 100 characters; every link reports', () => {
  assert.deepEqual(neuFehler({ links: [{ titel: 'a'.repeat(101), url: 'https://a.de' }] }), {
    'links.0.titel': 'Höchstens 100 Zeichen.',
  });
  assert.deepEqual(
    neuFehler({
      links: [
        { titel: 'ok', url: 'https://a.de' },
        { titel: 'a'.repeat(101), url: 'nein' },
        null,
        'text',
      ],
    }),
    {
      'links.1.titel': 'Höchstens 100 Zeichen.',
      'links.1.url': ADRESSE,
      'links.2.url': ADRESSE,
      'links.3.url': ADRESSE,
    }
  );
});

test('Gericht: at most ten links, given as a list', () => {
  const link = { titel: '', url: 'https://a.de' };
  assert.equal(neu({ name: 'A', personen: 1, links: Array(10).fill(link) }).links?.length, 10);
  assert.deepEqual(neuFehler({ links: Array(11).fill(link) }), { links: 'Höchstens 10 Links.' });
  assert.deepEqual(neuFehler({ links: Array(11).fill(null) }), { links: 'Höchstens 10 Links.' });
  for (const links of [null, 'x', {}, 3]) {
    assert.deepEqual(neuFehler({ links }), { links: 'Höchstens 10 Links.' });
  }
  assert.deepEqual(neu({ name: 'A', personen: 1, links: [] }).links, []);
});

test('Gericht: werkzeuge are trimmed, without empty ones and duplicates', () => {
  assert.deepEqual(
    neu({
      name: 'A',
      personen: 1,
      werkzeuge: [
        ' Topf ',
        'topf',
        '',
        '  ',
        4,
        null,
        'Große   Kelle',
        'GROßE KELLE',
        'Äxte',
        'äxte',
      ],
    }).werkzeuge,
    ['Topf', 'Große Kelle', 'Äxte']
  );
  assert.deepEqual(neu({ name: 'A', personen: 1, werkzeuge: [] }).werkzeuge, []);
});

test('Gericht: werkzeuge have at most 100 characters each and at most 30 entries', () => {
  assert.deepEqual(neuFehler({ werkzeuge: ['ok', 'a'.repeat(101)] }), {
    werkzeuge: 'Höchstens 100 Zeichen.',
  });
  const viele = Array.from({ length: 30 }, (_, index) => `w${index}`);
  assert.equal(neu({ name: 'A', personen: 1, werkzeuge: viele }).werkzeuge?.length, 30);
  assert.deepEqual(neuFehler({ werkzeuge: [...viele, 'w30'] }), {
    werkzeuge: 'Höchstens 30 Werkzeuge.',
  });
  for (const werkzeuge of [null, 'Topf', {}, 3]) {
    assert.deepEqual(neuFehler({ werkzeuge }), { werkzeuge: 'Höchstens 30 Werkzeuge.' });
  }
});

test('Gericht: a change sends only the fields that changed', () => {
  assert.deepEqual(aendern({ name: ' Neu  er Name ' }), { name: 'Neu er Name' });
  assert.deepEqual(aendern({ personen: 4 }), { personen: 4 });
  assert.deepEqual(aendern({ notiz: '', links: [], werkzeuge: [], anleitung: '  ' }), {
    notiz: '',
    links: [],
    werkzeuge: [],
    anleitung: '',
  });
  assert.deepEqual(aendern({ name: undefined, personen: 3, unbekannt: true }), { personen: 3 });
});

test('Gericht: a change that sends a field checks it', () => {
  assert.deepEqual(aendernFehler({ name: '  ' }), { name: NAME_FEHLT });
  assert.deepEqual(aendernFehler({ name: null }), { name: NAME_FEHLT });
  assert.deepEqual(aendernFehler({ name: 'a'.repeat(151) }), { name: 'Höchstens 150 Zeichen.' });
  assert.deepEqual(aendernFehler({ personen: 0 }), { personen: PERSONEN_UNGUELTIG });
  assert.deepEqual(aendernFehler({ personen: null }), { personen: PERSONEN_UNGUELTIG });
  assert.deepEqual(aendernFehler({ personen: 2001 }), { personen: 'Höchstens 2000 Personen.' });
  assert.deepEqual(aendernFehler({ links: [{ url: 'x' }], personen: 5 }), {
    'links.0.url': ADRESSE,
  });
  assert.deepEqual(aendernFehler({ werkzeuge: 'x', notiz: 'n'.repeat(1001) }), {
    werkzeuge: 'Höchstens 30 Werkzeuge.',
    notiz: 'Höchstens 1000 Zeichen.',
  });
});

test('Gericht: a change without any field has nothing to save', () => {
  const nichts = { name: 'Es gibt nichts zu speichern.' };
  for (const input of [undefined, null, 'x', [], {}, { name: undefined }, { unbekannt: 1 }]) {
    assert.deepEqual(aendernFehler(input), nichts);
  }
});

test('Gericht: a new dish with several faults reports every field', () => {
  assert.deepEqual(
    fields(() =>
      neu({
        name: '',
        personen: 0,
        anleitung: 'a'.repeat(20_001),
        notiz: 'n'.repeat(1001),
        links: [{ url: '' }],
        werkzeuge: ['w'.repeat(101)],
      })
    ),
    {
      name: NAME_FEHLT,
      personen: PERSONEN_UNGUELTIG,
      anleitung: 'Höchstens 20.000 Zeichen.',
      notiz: 'Höchstens 1000 Zeichen.',
      'links.0.url': ADRESSE,
      werkzeuge: 'Höchstens 100 Zeichen.',
    }
  );
});
