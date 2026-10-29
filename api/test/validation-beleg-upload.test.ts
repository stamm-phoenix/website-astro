import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPhoto, isPhotos, readPhotos } from '../lib/validation/beleg-upload';

/** Minimal JPEG header with a frame of the given size. */
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    ...new Array<number>(12).fill(0),
  ]);
}

const encode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const PHOTO = encode(jpeg(1200, 1600));
const PDF = Buffer.from('%PDF-1.4 minimal').toString('base64');

function failure(body: Record<string, unknown> | null): { status: number; code: string } {
  const result = readPhotos(body);
  assert.equal(isPhotos(result), false);
  const response = result as { status?: number; jsonBody?: { code: string } };
  return { status: response.status ?? 0, code: response.jsonBody?.code ?? '' };
}

test('a photo, with an optional original or a PDF, is decoded', () => {
  const photos = readPhotos({ photo: PHOTO });
  assert.ok(isPhotos(photos));
  assert.deepEqual(Buffer.from(photos.photo), Buffer.from(PHOTO, 'base64'));
  assert.equal(photos.original, undefined);
  const withOriginal = readPhotos({ photo: PHOTO, original: encode(jpeg(1500, 2000)), pdf: null });
  assert.ok(isPhotos(withOriginal) && withOriginal.original?.length === jpeg(1, 1).length);
  const withPdf = readPhotos({ photo: PHOTO, pdf: PDF, original: null });
  assert.ok(isPhotos(withPdf) && withPdf.pdf !== undefined && withPdf.original === undefined);
  assert.equal(isPhotos(readPhotos({ photo: PHOTO, original: undefined })), true);
});

test('a missing, invalid or unusable photo is refused', () => {
  for (const body of [
    null,
    {},
    { photo: 5 },
    { photo: '' },
    { photo: 'not base64!' },
    { photo: 'AAA' },
  ])
    assert.deepEqual(failure(body), { status: 400, code: 'INVALID' }, JSON.stringify(body));
  assert.deepEqual(failure({ photo: encode(jpeg(600, 400)) }), { status: 400, code: 'INVALID' });
  assert.deepEqual(failure({ photo: Buffer.from('plain text').toString('base64') }), {
    status: 400,
    code: 'INVALID',
  });
  assert.deepEqual(failure({ photo: PHOTO, original: 'x y' }), { status: 400, code: 'INVALID' });
  assert.deepEqual(failure({ photo: PHOTO, original: encode(jpeg(10, 10)) }), {
    status: 400,
    code: 'INVALID',
  });
});

test('a PDF must be one, and it has no original', () => {
  assert.deepEqual(failure({ photo: PHOTO, pdf: Buffer.from('GIF89a').toString('base64') }), {
    status: 400,
    code: 'INVALID',
  });
  assert.deepEqual(failure({ photo: PHOTO, pdf: '%%%' }), { status: 400, code: 'INVALID' });
  assert.deepEqual(failure({ photo: PHOTO, pdf: PDF, original: PHOTO }), {
    status: 400,
    code: 'INVALID',
  });
});

test('oversized files are refused with 413', () => {
  const big = new Uint8Array(4 * 1024 * 1024 + 1);
  big.set(jpeg(1200, 1600));
  assert.equal(checkPhoto(big)?.status, 413);
  assert.deepEqual(failure({ photo: encode(big) }), { status: 413, code: 'TOO_LARGE' });
  const pdf = new Uint8Array(5 * 1024 * 1024 + 1);
  pdf.set(Buffer.from('%PDF-'));
  assert.deepEqual(failure({ photo: PHOTO, pdf: encode(pdf) }), { status: 413, code: 'TOO_LARGE' });
  assert.equal(checkPhoto(jpeg(1200, 1600)), undefined);
});
