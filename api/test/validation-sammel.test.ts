import assert from 'node:assert/strict';
import test from 'node:test';
import {
  email,
  object,
  reference,
  text,
  validateSammelItems,
} from '../lib/sammelbestellung-validation';
import { ValidationError } from '../lib/validation/errors';

function fields(run: () => unknown): Record<string, string> {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields;
    throw error;
  }
  return assert.fail('Expected a ValidationError.');
}

const textMessage = (max: number): string =>
  `Bitte gib einen Text mit höchstens ${max} Zeichen ein.`;
const STAMM = 'Bitte wähle einen Stammesartikel aus dem Katalog.';
const LINK =
  'Bitte gib eine Artikelnummer oder einen HTTPS-Link zu Rüsthaus oder Ausrüster Eschwege ein.';
const RUESTHAUS = 'https://www.ruesthaus.de/123/zelt';
const ESCHWEGE = 'https://www.ausruester-eschwege.de/product_info.php?products_id=42';

test('text is trimmed and bounded, optional text may be missing', () => {
  assert.equal(text('  Zelt  ', 'name', 10), 'Zelt');
  assert.equal(text(' x ', 'name', 1), 'x');
  assert.equal(text(undefined, 'name', 10, true), '');
  assert.equal(text('', 'name', 10, true), '');
  assert.equal(text('   ', 'name', 10, true), '');
  assert.equal(text(' a ', 'name', 10, true), 'a');
  for (const value of [
    undefined,
    null,
    '',
    '   ',
    5,
    {},
    [],
    'x'.repeat(11),
    ` ${'x'.repeat(11)} `,
  ])
    assert.deepEqual(
      fields(() => text(value, 'name', 10)),
      { name: textMessage(10) }
    );
  for (const value of [null, 5, {}, 'x'.repeat(11)])
    assert.deepEqual(
      fields(() => text(value, 'notes', 10, true)),
      { notes: textMessage(10) }
    );
  assert.equal(text(`  ${'x'.repeat(10)}  `, 'name', 10), 'x'.repeat(10));
});

test('an e-mail address is normalised and checked', () => {
  assert.equal(email(' Anna@Stamm-Phoenix.DE '), 'anna@stamm-phoenix.de');
  const invalid = 'Bitte gib eine gültige E-Mail-Adresse ein.';
  for (const value of ['anna', 'anna@x', '@x.de', 'a b@x.de', 'a@x .de'])
    assert.deepEqual(
      fields(() => email(value)),
      { email: invalid },
      value
    );
  for (const value of [undefined, '', ' ', 3, `${'a'.repeat(250)}@b.de`])
    assert.deepEqual(
      fields(() => email(value)),
      { email: textMessage(254) },
      String(value)
    );
});

test('the submitted value must be an object', () => {
  const body = { a: 1 };
  assert.equal(object(body), body);
  for (const value of [null, undefined, [], 'text', 5, true])
    assert.deepEqual(
      fields(() => object(value)),
      { form: 'Bitte prüfe die Eingaben.' },
      String(value)
    );
});

test('references are article numbers, stock products or links of the known shops', () => {
  assert.equal(reference(' 12-AB_c.d '), '12-AB_c.d');
  assert.equal(reference('stamm-halstuch'), 'stamm-halstuch');
  assert.equal(reference(`${RUESTHAUS}#frag`), RUESTHAUS);
  assert.equal(reference(`${ESCHWEGE}&osCsid=abc&action=x`), ESCHWEGE);
  for (const value of ['stamm-fake', 'STAMM-HALSTUCH', 'Stamm-Fake'])
    assert.deepEqual(
      fields(() => reference(value)),
      { reference: STAMM },
      value
    );
  for (const value of [
    'http://www.ruesthaus.de/123/zelt',
    'https://evil.example/123/zelt',
    'https://user@www.ruesthaus.de/1/a',
    'https://www.ruesthaus.de:8443/1/a',
    'javascript:alert(1)',
    'zelt mit leerzeichen',
    'a'.repeat(81),
  ])
    assert.deepEqual(
      fields(() => reference(value)),
      { reference: LINK },
      value
    );
  for (const value of [undefined, null, '', ' ', 5, 'x'.repeat(501)])
    assert.deepEqual(
      fields(() => reference(value)),
      { reference: textMessage(500) },
      String(value)
    );
});

const ITEM = { reference: '123', name: 'Zelt', variant: 'blau', quantity: 2 };

test('order rows are normalised and the supplier is inferred', () => {
  assert.deepEqual(validateSammelItems([{ ...ITEM, name: ' Zelt ', variant: '', extra: 1 }]), [
    { ...ITEM, variant: '' },
  ]);
  assert.deepEqual(validateSammelItems([{ ...ITEM, variant: undefined }]), [
    { ...ITEM, variant: '' },
  ]);
  assert.deepEqual(validateSammelItems([{ ...ITEM, shop: 'ruesthaus' }]), [ITEM]);
  assert.deepEqual(validateSammelItems([{ ...ITEM, shop: 'eschwege' }]), [
    { ...ITEM, shop: 'eschwege' },
  ]);
  assert.deepEqual(validateSammelItems([{ ...ITEM, reference: `${ESCHWEGE}&osCsid=1` }]), [
    { ...ITEM, reference: ESCHWEGE, shop: 'eschwege' },
  ]);
  assert.deepEqual(
    validateSammelItems([{ ...ITEM, reference: `${RUESTHAUS}#x`, shop: 'eschwege' }]),
    [{ ...ITEM, reference: RUESTHAUS }]
  );
  assert.deepEqual(
    validateSammelItems([
      { ...ITEM, quantity: 99, excluded: { reason: ' ausverkauft ', other: 1 } },
      { ...ITEM, excluded: {} },
    ]),
    [
      { ...ITEM, quantity: 99, excluded: { reason: 'ausverkauft' } },
      { ...ITEM, excluded: { reason: '' } },
    ]
  );
});

test('stock products take their own name and no variant', () => {
  assert.deepEqual(
    validateSammelItems([
      { reference: 'stamm-halstuch', name: 5, variant: 5, quantity: 1, shop: 'eschwege' },
    ]),
    [
      {
        shop: 'stamm',
        reference: 'stamm-halstuch',
        name: 'Stamm Phoenix Halstuch',
        variant: '',
        quantity: 1,
      },
    ]
  );
  assert.deepEqual(
    fields(() => validateSammelItems([{ ...ITEM, shop: 'stamm' }])),
    {
      reference: STAMM,
    }
  );
});

test('the list of order rows has 1 to 40 rows', () => {
  const items = 'Bitte gib 1 bis 40 Artikel an.';
  for (const value of [undefined, null, 'x', {}, []])
    assert.deepEqual(
      fields(() => validateSammelItems(value)),
      { items }
    );
  assert.deepEqual(
    fields(() => validateSammelItems(Array(41).fill(ITEM))),
    { items }
  );
  assert.equal(validateSammelItems(Array(40).fill(ITEM)).length, 40);
});

test('an order row reports what is wrong with it', () => {
  const quantity = 'Die Anzahl muss zwischen 1 und 99 liegen.';
  for (const value of [0, 100, -1, 1.5, '2', null, undefined, NaN, true])
    assert.deepEqual(
      fields(() => validateSammelItems([{ ...ITEM, quantity: value }])),
      { quantity },
      String(value)
    );
  for (const row of [null, 'x', [], undefined])
    assert.deepEqual(
      fields(() => validateSammelItems([row])),
      { form: 'Bitte prüfe die Eingaben.' }
    );
  assert.deepEqual(
    fields(() => validateSammelItems([{ ...ITEM, shop: 'amazon' }])),
    {
      shop: 'Bitte wähle Rüsthaus oder Ausrüster Eschwege.',
    }
  );
  assert.deepEqual(
    fields(() => validateSammelItems([{ ...ITEM, shop: null }])),
    {
      shop: 'Bitte wähle Rüsthaus oder Ausrüster Eschwege.',
    }
  );
  assert.deepEqual(
    fields(() => validateSammelItems([{ ...ITEM, reference: 'http://x.de' }])),
    {
      reference: LINK,
    }
  );
  assert.deepEqual(
    fields(() => validateSammelItems([{ ...ITEM, reference: 'stamm-fake' }])),
    {
      reference: STAMM,
    }
  );
  assert.deepEqual(
    fields(() => validateSammelItems([{ ...ITEM, name: ' ' }])),
    {
      name: textMessage(200),
    }
  );
  assert.deepEqual(
    fields(() => validateSammelItems([{ ...ITEM, name: 'x'.repeat(201) }])),
    {
      name: textMessage(200),
    }
  );
  assert.deepEqual(
    fields(() => validateSammelItems([{ ...ITEM, variant: 'x'.repeat(121) }])),
    {
      variant: textMessage(120),
    }
  );
  assert.deepEqual(
    fields(() => validateSammelItems([{ ...ITEM, variant: 3 }])),
    {
      variant: textMessage(120),
    }
  );
  for (const excluded of [null, 'x', []])
    assert.deepEqual(
      fields(() => validateSammelItems([{ ...ITEM, excluded }])),
      {
        form: 'Bitte prüfe die Eingaben.',
      }
    );
  assert.deepEqual(
    fields(() => validateSammelItems([{ ...ITEM, excluded: { reason: 'x'.repeat(1001) } }])),
    { reason: textMessage(1000) }
  );
});

test('a faulty row is reported with the first fault of its kind', () => {
  const message = fields(() =>
    validateSammelItems([ITEM, { ...ITEM, quantity: 0 }, { ...ITEM, name: '' }])
  ).quantity;
  assert.equal(message, 'Die Anzahl muss zwischen 1 und 99 liegen.');
});
