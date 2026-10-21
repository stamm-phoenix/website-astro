import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { app } from '@azure/functions';

// The Functions host loads the bundle (`main` in package.json), the other tests the tsc output
const API = join(__dirname, '..', '..');
const MAIN = join(
  API,
  (JSON.parse(readFileSync(join(API, 'package.json'), 'utf8')) as { main: string }).main
);
const BUNDLE = dirname(MAIN);

async function registeredFunctions(t: test.TestContext, entry: string): Promise<string[]> {
  const names: string[] = [];
  t.mock.method(app, 'http', (name: string) => names.push(name));
  await import(entry);
  return names.sort();
}

test('the bundle registers the same functions as the sources', async (t) => {
  const fromSources = await registeredFunctions(t, join(__dirname, '..', 'main.js'));
  const fromBundle = await registeredFunctions(t, MAIN);
  assert.ok(fromSources.length > 100);
  assert.deepEqual(fromBundle, fromSources);
});

test('files the bundle reads next to itself are where it looks for them', async () => {
  // Fonts, images and templates are read from `<__dirname>/../../assets`, as from dist/lib
  assert.ok(existsSync(join(BUNDLE, '..', '..', 'assets', 'fonts', 'SourceSans3-Regular.ttf')));
  assert.ok(existsSync(join(BUNDLE, '..', '..', 'assets', 'kjr-teilnahmeliste.xlsx')));

  const stream = 'BT /F1 12 Tf 40 100 Td (Zelte zaehlen) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let source = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((value, index) => {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${value}\nendobj\n`;
  });
  const start = source.length;
  source += `xref\n0 6\n0000000000 65535 f \n${offsets
    .map((value) => `${String(value).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;

  // The PDF text is read in a worker started from the bundle's own folder
  const text = await new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(join(BUNDLE, 'protokoll-pdf-worker.js'), {
      workerData: Buffer.from(source, 'latin1'),
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`worker exited with ${code}`)));
  });
  assert.match(String(text), /Zelte zaehlen/);
});
