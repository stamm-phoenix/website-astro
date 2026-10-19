import assert from 'node:assert/strict';
import test from 'node:test';
import { buildZip, crc32 } from '../src/lib/fotoZip.ts';
import { fotoAktionen, recentFotoAktionen, searchFotoAktionen } from '../src/lib/fotoAktionen.ts';
import { fotoAnsichtHash, readFotoAnsicht } from '../src/lib/fotoAnsicht.ts';
import { selectFotoFiles, uploadName } from '../src/lib/fotoAuswahl.ts';
import type { CampflowEvent, StaffAktion } from '../src/lib/types.ts';

test('crc32 matches the reference value and continues over parts', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xcbf43926);
  assert.equal(crc32(bytes.slice(4), crc32(bytes.slice(0, 4))), 0xcbf43926);
});

test('buildZip stores each file with its name and a central directory', async () => {
  const data = new TextEncoder().encode('Hallo');
  const zip = new Uint8Array(
    await buildZip([
      { name: 'Ä.jpg', data: new Blob([data]), crc: crc32(data), modified: new Date(2026, 6, 1) },
    ]).arrayBuffer()
  );
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 1);
  const name = new TextDecoder().decode(zip.slice(30, 30 + view.getUint16(26, true)));
  assert.equal(name, 'Ä.jpg');
  assert.equal(new TextDecoder().decode(zip.slice(30 + 6, 30 + 6 + 5)), 'Hallo');
});

function event(id: string, title: string, start: string | null): CampflowEvent {
  return {
    id,
    title,
    published: true,
    start_date: start,
    end_date: start,
    max_persons: null,
    archived: false,
    url: null,
    collection: null,
    zuschussfaehig: true,
    keineAktion: false,
  };
}

test('fotoAktionen takes the day and year of a CampFlow time in Berlin', () => {
  const [item] = fotoAktionen([event('s', 'Silvester', '2025-12-31T23:30:00Z')], [], '2026-01-05');
  assert.equal(item.start, '2026-01-01');
  assert.equal(item.year, '2026');
});

test('fotoAktionen leaves out events that are no Aktion and their calendar entries', () => {
  const pulli = { ...event('p', 'Stammespulli', '2026-06-24'), keineAktion: true };
  const entry: StaffAktion = {
    id: '1',
    etag: '',
    campflowId: 'p',
    title: 'Stammespulli',
    stufen: [],
    start: '2026-06-24',
    end: '2026-06-24',
    link: '',
    description: '',
  };
  const items = fotoAktionen([pulli, event('s', 'Sola', '2026-07-01')], [entry], '2026-07-05');
  assert.deepEqual(
    items.map((item) => item.title),
    ['Sola']
  );
});

test('fotoAktionen merges CampFlow and calendar, newest begun first', () => {
  const entries: StaffAktion[] = [
    {
      id: '1',
      etag: '',
      campflowId: 'a',
      title: 'Sola (Kalender)',
      stufen: [],
      start: '2026-07-01',
      end: '2026-07-10',
      link: '',
      description: '',
    },
    {
      id: '2',
      etag: '',
      campflowId: null,
      title: 'Waldputz',
      stufen: [],
      start: '2026-09-20',
      end: '2026-09-20',
      link: '',
      description: '',
    },
  ];
  const items = fotoAktionen(
    [
      event('a', 'Sola', '2026-07-01'),
      event('b', 'Nikolaus', '2026-12-05'),
      event('c', 'Alt', null),
    ],
    entries,
    '2026-10-16'
  );
  assert.deepEqual(
    items.map((item) => item.title),
    ['Waldputz', 'Sola', 'Nikolaus', 'Alt']
  );
  assert.equal(items[3].year, '2026');
  assert.deepEqual(
    recentFotoAktionen(items, '2026-10-16').map((item) => item.title),
    ['Waldputz', 'Sola']
  );
  assert.deepEqual(
    searchFotoAktionen(items, 'sola 2026').map((item) => item.title),
    ['Sola']
  );
});

test('the view survives the round trip through the hash', () => {
  const view = { path: '2026/Sola & Co', foto: 'x1', upload: false, ziel: null };
  assert.deepEqual(readFotoAnsicht(fotoAnsichtHash(view)), view);
  assert.equal(fotoAnsichtHash({ path: '', foto: null, upload: false, ziel: null }), '#pfad=');
  assert.deepEqual(readFotoAnsicht('#ansicht=hochladen&ziel=2025'), {
    path: '',
    foto: null,
    upload: true,
    ziel: '2025',
  });
});

test('media without extension get an extension the upload accepts', () => {
  const video = new File(['x'], 'Film', { type: 'video/3gpp' });
  const bmp = new File(['x'], 'Bild', { type: 'image/x-ms-bmp' });
  const text = new File(['x'], 'Notiz', { type: 'text/plain' });
  const selection = selectFotoFiles([video, bmp, text]);
  assert.deepEqual(
    selection.files.map((file, index) => uploadName(file, index)),
    ['Film.3gp', 'Bild.bmp']
  );
  assert.deepEqual(selection.rejected, ['Notiz']);
});

test('cleaning a name keeps its media extension', () => {
  assert.equal(uploadName(new File(['x'], '_vti_Foto.ARW'), 0), 'Foto 1.ARW');
  assert.equal(uploadName(new File(['x'], '_vti_Film.mp4'), 1), 'Foto 2.mp4');
});
