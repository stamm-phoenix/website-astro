import { deflateSync } from 'node:zlib';
import { ValidationError } from '../lib/validation/errors';
import assert from 'node:assert/strict';
import test from 'node:test';
import { protokollToText, assertProtokollSize, MAX_PROTOKOLL_BYTES } from '../lib/protokoll-text';
import { fileContentVersion } from '../lib/protokoll-content-version';
import { parseProtokollFileName, isProtokollFile } from '../lib/protokolle';
import { docx, paragraph } from './fixtures/docx';

/** Small valid PDF with one page and optional selectable text, no external fixtures. */
function pdf(text: string, compressed = false, pages = 1): Uint8Array {
  const stream = text ? `BT /F1 12 Tf 40 100 Td (${text}) Tj ET` : '';
  const encoded = compressed ? deflateSync(Buffer.from(stream)).toString('latin1') : stream;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array(pages).fill('3 0 R').join(' ')}] /Count ${pages} >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10000000 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${encoded.length}${compressed ? ' /Filter /FlateDecode' : ''} >>\nstream\n${encoded}\nendstream`,
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((value, index) => {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${value}\nendobj\n`;
  });
  const start = source.length;
  source += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((value) => String(value).padStart(10, '0') + ' 00000 n \n')
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(source, 'latin1');
}
test('DOCX, UTF-8 and BOM UTF-16 retain quotes for model validation', async () => {
  assert.match(
    await protokollToText(docx(paragraph('Material prüfen')), 'meeting.docx'),
    /Material prüfen/
  );
  assert.equal(
    await protokollToText(Buffer.from('Nächste Runde\r\n@Hugo'), 'meeting.TXT'),
    'Nächste Runde\n@Hugo'
  );
  assert.equal(
    await protokollToText(Buffer.from('\ufeffNächste Runde', 'utf16le'), 'meeting.txt'),
    'Nächste Runde'
  );
  await assert.rejects(
    protokollToText(Uint8Array.of(0xff, 0x01), 'meeting.txt'),
    (error: unknown) => error instanceof ValidationError && /UTF-8/.test(error.fields.form)
  );
  await assert.rejects(
    protokollToText(Buffer.from('a\0b'), 'meeting.txt'),
    (error: unknown) => error instanceof ValidationError && /Klartext/.test(error.fields.form)
  );
});
test('PDF text is extracted locally; scans and broken PDFs explain manual fallback', async () => {
  const input = pdf('Hugo: Material pruefen');
  const original = Uint8Array.from(input);
  assert.match(await protokollToText(input, 'meeting.pdf'), /Hugo: Material pruefen/);
  assert.deepEqual(
    Uint8Array.from(input),
    original,
    'PDF worker transfer must preserve caller-owned bytes'
  );
  await assert.rejects(
    protokollToText(pdf(''), 'scan.pdf'),
    (error: unknown) => error instanceof ValidationError && /Textebene/.test(error.fields.form)
  );
  await assert.rejects(
    protokollToText(Buffer.from('not a PDF'), 'bad.pdf'),
    (error: unknown) => error instanceof ValidationError && /Textebene/.test(error.fields.form)
  );
});
test('PDF/TXT file names and versions are format-aware and restricted to the folder', () => {
  for (const extension of ['pdf', 'txt', 'DOCX']) {
    const name = `2026-10-13_Leitendenrunde.${extension}`;
    assert.deepEqual(parseProtokollFileName(name), { date: '2026-10-13', title: 'Leitendenrunde' });
    assert.equal(
      isProtokollFile(
        {
          id: '1',
          name,
          file: {},
          parentReference: { path: '/drives/a/root:/Protokolle/Leitendenrunde' },
        },
        'Protokolle/Leitendenrunde'
      ),
      true
    );
  }
  assert.notEqual(
    fileContentVersion(Buffer.from('a'), 'a.txt'),
    fileContentVersion(Buffer.from('b'), 'a.txt')
  );
  assert.match(fileContentVersion(pdf('a'), 'a.pdf'), /^file-sha256:/);
});

test('protocol byte limits reject before parsing and validate reported drive sizes', async () => {
  for (const size of [MAX_PROTOKOLL_BYTES + 1, -1, Number.NaN, Infinity])
    assert.throws(() => assertProtokollSize(size), ValidationError);
  assert.doesNotThrow(() => assertProtokollSize(MAX_PROTOKOLL_BYTES));
  await assert.rejects(
    protokollToText(new Uint8Array(MAX_PROTOKOLL_BYTES + 1), 'large.pdf'),
    ValidationError
  );
});

test('highly compressed PDF text and excessive page counts fail while the event loop stays responsive', async () => {
  const input = pdf('repeated text '.repeat(30_000), true);
  assert.ok(input.byteLength < 10_000);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  try {
    await assert.rejects(protokollToText(input, 'compressed.pdf'), ValidationError);
    assert.ok(ticks > 0, 'parsing must not block the Functions event loop');
    await assert.rejects(protokollToText(pdf('hello', true, 201), 'pages.pdf'), ValidationError);
    assert.match(await protokollToText(pdf('still healthy', true), 'ok.pdf'), /still healthy/);
  } finally {
    clearInterval(timer);
  }
});
