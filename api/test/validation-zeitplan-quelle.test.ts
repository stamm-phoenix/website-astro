import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_ZEITPLAN_BILDER,
  MAX_ZEITPLAN_FREITEXT,
  MAX_ZEITPLAN_TEXT,
} from '../lib/kurzbeschreibung-zeitplan';
import { readQuelle } from '../lib/validation/zeitplan-quelle';
import { writeZip } from '../lib/zip';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const b64 = (bytes: Uint8Array | string): string => Buffer.from(bytes).toString('base64');
const JPEG64 = b64(JPEG);

const NOT_READABLE =
  'Die Datei konnte nicht gelesen werden. Bitte ein Foto, ein PDF oder eine Excel-Datei wählen.';
const NO_SOURCE = 'Bitte ein Foto, ein PDF oder eine Excel-Datei wählen.';
const TABLE_SIZE = 'Die Tabelle ist zu groß (höchstens 2 MB) oder leer.';
const TABLE_FORMAT =
  'Bitte die Tabelle als Excel-Datei (.xlsx) oder CSV speichern und erneut wählen.';
const XLSX_UNREADABLE =
  'Die Excel-Datei konnte nicht gelesen werden. Bitte als .xlsx speichern und erneut wählen.';
const TABLE_EMPTY = 'In der Tabelle steht nichts. Bitte eine andere Datei wählen.';
const TABLE_LONG =
  'Die Tabelle ist zu lang. Speichere nur das Blatt mit dem Zeitplan in einer eigenen Datei und wähle diese.';
const IMAGE_COUNT = `Bitte höchstens ${MAX_ZEITPLAN_BILDER} Seiten oder Fotos auf einmal hochladen.`;

function xlsx(): Uint8Array {
  return new Uint8Array(
    writeZip([
      {
        name: 'xl/workbook.xml',
        data: Buffer.from(
          '<workbook xmlns:r="r"><sheets><sheet name="Plan" sheetId="1" r:id="rId1"/></sheets></workbook>'
        ),
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: Buffer.from(
          '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
        ),
      },
      { name: 'xl/sharedStrings.xml', data: Buffer.from('<sst><si><t>Frühstück</t></si></sst>') },
      {
        name: 'xl/worksheets/sheet1.xml',
        data: Buffer.from(
          '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>'
        ),
      },
    ])
  );
}

const table = (name: unknown, data: unknown) => ({ tabelle: { name, data } });

test('a description is trimmed and kept as it is otherwise', () => {
  assert.deepEqual(readQuelle({ freitext: '  Samstag\n  9 Uhr  Frühstück \n' }), {
    freitext: 'Samstag\n  9 Uhr  Frühstück',
  });
  assert.deepEqual(readQuelle({ freitext: 'x'.repeat(MAX_ZEITPLAN_FREITEXT) }), {
    freitext: 'x'.repeat(MAX_ZEITPLAN_FREITEXT),
  });
});

test('a description that is empty or too long is refused with its own message', () => {
  assert.equal(readQuelle({ freitext: ' \n ' }), 'Beschreibe zuerst den Ablauf der Aktion.');
  assert.equal(readQuelle({ freitext: '' }), 'Beschreibe zuerst den Ablauf der Aktion.');
  const long = readQuelle({ freitext: 'x'.repeat(MAX_ZEITPLAN_FREITEXT + 1) });
  assert.equal(
    long,
    `Die Beschreibung ist zu lang (höchstens ${MAX_ZEITPLAN_FREITEXT.toLocaleString('de-DE')} Zeichen). Kürze sie bitte.`
  );
  // The limit counts the trimmed text
  assert.deepEqual(readQuelle({ freitext: ` ${'x'.repeat(MAX_ZEITPLAN_FREITEXT)} ` }), {
    freitext: 'x'.repeat(MAX_ZEITPLAN_FREITEXT),
  });
});

test('a description wins over images and a table; a non-string description does not count', () => {
  assert.deepEqual(readQuelle({ freitext: 'Plan', bilder: [], tabelle: 5 }), { freitext: 'Plan' });
  assert.equal(
    readQuelle({ freitext: '', bilder: [JPEG64] }),
    'Beschreibe zuerst den Ablauf der Aktion.'
  );
  assert.deepEqual(readQuelle({ freitext: 5, bilder: [JPEG64] }), { bilder: [JPEG] });
  assert.equal(readQuelle({ freitext: null }), NO_SOURCE);
});

test('images are decoded to bytes and must be one to four JPEGs', () => {
  assert.deepEqual(readQuelle({ bilder: [JPEG64, JPEG64] }), { bilder: [JPEG, JPEG] });
  assert.deepEqual(readQuelle({ bilder: Array<string>(MAX_ZEITPLAN_BILDER).fill(JPEG64) }), {
    bilder: Array<Uint8Array>(MAX_ZEITPLAN_BILDER).fill(JPEG),
  });
  assert.equal(readQuelle({ bilder: [] }), IMAGE_COUNT);
  assert.equal(
    readQuelle({ bilder: Array<string>(MAX_ZEITPLAN_BILDER + 1).fill(JPEG64) }),
    IMAGE_COUNT
  );
});

test('the number of images is checked before the images themselves', () => {
  assert.equal(
    readQuelle({ bilder: Array<unknown>(MAX_ZEITPLAN_BILDER + 1).fill(5) }),
    IMAGE_COUNT
  );
  assert.equal(readQuelle({ bilder: [5] }), NOT_READABLE);
});

test('an image that is no string, empty, too big or no JPEG is refused', () => {
  for (const bild of [
    5,
    null,
    {},
    [JPEG64],
    '',
    b64('GIF89a-not-a-jpeg'),
    b64(new Uint8Array([0xff, 0xd8, 0xff])),
  ]) {
    assert.equal(readQuelle({ bilder: [bild] }), NOT_READABLE, JSON.stringify(bild));
  }
  assert.equal(readQuelle({ bilder: [JPEG64, 'AAAA'] }), NOT_READABLE);
  const big = new Uint8Array(4 * 1024 * 1024 + 1);
  big.set([0xff, 0xd8, 0xff]);
  assert.equal(readQuelle({ bilder: [b64(big)] }), NOT_READABLE);
  const max = new Uint8Array(4 * 1024 * 1024);
  max.set([0xff, 0xd8, 0xff]);
  assert.deepEqual(readQuelle({ bilder: [b64(max)] }), { bilder: [max] });
});

test('images win over a table, a table needs an object', () => {
  assert.deepEqual(readQuelle({ bilder: [JPEG64], tabelle: table('a.csv', b64('x')).tabelle }), {
    bilder: [JPEG],
  });
  assert.equal(readQuelle({ bilder: [], tabelle: table('a.csv', b64('x')).tabelle }), IMAGE_COUNT);
  assert.equal(readQuelle({ bilder: 'x' }), NO_SOURCE);
  for (const tabelle of ['x', 5, [], null, false, 0, '']) {
    assert.equal(readQuelle({ tabelle }), NO_SOURCE, JSON.stringify(tabelle));
  }
});

test('nothing usable in the body gives the general message', () => {
  assert.equal(readQuelle(null), NO_SOURCE);
  assert.equal(readQuelle({}), NO_SOURCE);
  assert.equal(readQuelle({ other: 1 }), NO_SOURCE);
});

test('a CSV file becomes its text, whatever the case of the extension', () => {
  assert.deepEqual(readQuelle(table('Plan.csv', b64('von;bis\n9;10'))), { text: 'von;bis\n9;10' });
  assert.deepEqual(readQuelle(table('PLAN.CSV', b64('Frühstück'))), { text: 'Frühstück' });
  assert.deepEqual(readQuelle(table('.csv', b64('a'))), { text: 'a' });
});

test('an Excel file becomes its text', () => {
  assert.deepEqual(readQuelle(table('Plan.xlsx', b64(xlsx()))), { text: '# Plan\nFrühstück' });
  assert.deepEqual(readQuelle(table('PLAN.XLSX', b64(xlsx()))), { text: '# Plan\nFrühstück' });
});

test('a table that is missing, empty, too big or has no name is refused', () => {
  const big = b64(new Uint8Array(2 * 1024 * 1024 + 1).fill(65));
  for (const tabelle of [
    { name: 'a.csv' },
    { name: 'a.csv', data: '' },
    { name: 'a.csv', data: 5 },
    { name: 'a.csv', data: big },
    { data: b64('x') },
    { name: 5, data: b64('x') },
    { name: null, data: b64('x') },
    {},
  ]) {
    assert.equal(readQuelle({ tabelle }), TABLE_SIZE, JSON.stringify(tabelle).slice(0, 40));
  }
  const max = b64(new Uint8Array(2 * 1024 * 1024).fill(65));
  // 2 MB is still accepted as a file, but its text is far too long for a Zeitplan
  assert.equal(readQuelle(table('a.csv', max)), TABLE_LONG);
});

test('a table that is neither Excel nor CSV is refused only when its size is fine', () => {
  for (const name of ['a.xls', 'a.csv.txt', 'a.xlsxx', 'xlsx', '', 'a.ods']) {
    assert.equal(readQuelle(table(name, b64('x'))), TABLE_FORMAT, name);
  }
  assert.equal(readQuelle(table('a.xls', '')), TABLE_SIZE);
});

test('an Excel file that cannot be read is refused', () => {
  assert.equal(readQuelle(table('a.xlsx', b64('not a zip file'))), XLSX_UNREADABLE);
  assert.equal(readQuelle(table('a.xlsx', b64(new Uint8Array([0, 1, 2, 3])))), XLSX_UNREADABLE);
});

test('a table without text or with too much text is refused', () => {
  assert.equal(readQuelle(table('a.csv', b64(' \n\t '))), TABLE_EMPTY);
  assert.equal(readQuelle(table('a.csv', b64(' '.repeat(MAX_ZEITPLAN_TEXT + 1)))), TABLE_EMPTY);
  assert.equal(readQuelle(table('a.csv', b64('a'.repeat(MAX_ZEITPLAN_TEXT + 1)))), TABLE_LONG);
  assert.deepEqual(readQuelle(table('a.csv', b64('a'.repeat(MAX_ZEITPLAN_TEXT)))), {
    text: 'a'.repeat(MAX_ZEITPLAN_TEXT),
  });
});
