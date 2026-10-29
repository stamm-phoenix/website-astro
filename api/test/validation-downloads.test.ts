import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import {
  DownloadItem,
  DownloadUploadComplete,
  DownloadUploadStart,
} from '../endpoints/intern-pflege-downloads';
import { newDownloadKey } from '../lib/downloads';
import { MAX_UPLOAD_BYTES } from '../lib/validation/constants';
import { UPLOAD_PART_BYTES, checkFileName } from '../lib/validation/downloads';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};

function request(method: string, body: unknown, params: Record<string, string> = {}): HttpRequest {
  return new HttpRequest({
    url: 'http://localhost/api/test',
    method,
    headers: {
      'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
      'content-type': 'application/json',
    },
    params,
    body: { string: typeof body === 'string' ? body : JSON.stringify(body) },
  });
}

const context = new InvocationContext({ functionName: 'validation-downloads-test' });
context.log = () => undefined;

interface Rejection {
  status: number | undefined;
  fields: Record<string, string>;
  message: string;
}

/** The answer of an endpoint to input that must be rejected before anything is stored. */
async function rejected(
  response: Promise<{ status?: number; jsonBody?: unknown }>
): Promise<Rejection> {
  const { status, jsonBody } = await response;
  const body = jsonBody as {
    error: string;
    code: string;
    message: string;
    fields: Record<string, string>;
  };
  assert.equal(body.error, 'INVALID');
  assert.equal(body.code, 'INVALID');
  return { status, fields: body.fields, message: body.message };
}

const NAME_ERROR = 'Bitte einen Dateinamen angeben.';

test('file names are checked with a German message each', () => {
  assert.equal(checkFileName('Packliste.pdf'), undefined);
  assert.equal(checkFileName('Lager (2026) – Info.docx'), undefined);
  assert.equal(checkFileName(undefined), NAME_ERROR);
  assert.equal(checkFileName(5), NAME_ERROR);
  assert.equal(checkFileName(null), NAME_ERROR);
  assert.equal(checkFileName(''), NAME_ERROR);
  assert.equal(checkFileName('   '), NAME_ERROR);
  assert.equal(
    checkFileName(`${'a'.repeat(197)}.pdf`),
    'Der Dateiname darf höchstens 200 Zeichen lang sein.'
  );
  assert.equal(checkFileName(`${'a'.repeat(196)}.pdf`), undefined);
  const characters = 'Der Dateiname darf keines dieser Zeichen enthalten: " * : < > ? / \\ | # %';
  for (const name of [
    'a"b.pdf',
    'a*b.pdf',
    'a:b.pdf',
    'a<b.pdf',
    'a>b.pdf',
    'a?b.pdf',
    'a/b.pdf',
    'a\\b.pdf',
    'a|b.pdf',
    'a#b.pdf',
    'a%b.pdf',
    '.a.pdf',
    'a.pdf.',
  ]) {
    assert.equal(checkFileName(name), characters, name);
  }
  for (const name of ['Packliste', 'a.', 'a.toolongext1', 'a. pdf', 'a.p-f']) {
    assert.notEqual(checkFileName(name), undefined, name);
  }
  assert.equal(checkFileName('Packliste'), 'Der Dateiname braucht eine Dateiendung.');
  assert.equal(checkFileName(' a.pdf'), undefined);
  assert.equal(checkFileName('a.pdf '), 'Der Dateiname braucht eine Dateiendung.');
});

test('the upload sizes are limits of 250 MB and 4 MB parts', () => {
  assert.equal(MAX_UPLOAD_BYTES, 250 * 1024 * 1024);
  assert.equal(UPLOAD_PART_BYTES, 4 * 1024 * 1024);
});

test('starting an upload checks the file name and the size before anything else', async () => {
  const sizeError = 'Die Datei ist leer oder größer als 250 MB.';
  for (const body of [
    {},
    { fileName: 5, size: 1 },
    { fileName: '  ', size: 1 },
    { fileName: 'a', size: 1 },
  ]) {
    const answer = await rejected(DownloadUploadStart(request('POST', body), context));
    assert.equal(answer.status, 400);
    assert.deepEqual(Object.keys(answer.fields), ['fileName']);
  }
  assert.deepEqual(
    (await rejected(DownloadUploadStart(request('POST', 'kein json'), context))).fields,
    {
      fileName: NAME_ERROR,
    }
  );
  assert.deepEqual((await rejected(DownloadUploadStart(request('POST', [1]), context))).fields, {
    fileName: NAME_ERROR,
  });
  for (const size of [undefined, null, '5', 0, -1, MAX_UPLOAD_BYTES + 1]) {
    const answer = await rejected(
      DownloadUploadStart(request('POST', { fileName: 'a.pdf', size }), context)
    );
    assert.equal(answer.status, 400);
    assert.deepEqual(answer.fields, { size: sizeError });
    assert.equal(answer.message, sizeError);
  }
  // Only the first problem is answered
  const both = await rejected(
    DownloadUploadStart(request('POST', { fileName: 'a', size: 0 }), context)
  );
  assert.deepEqual(both.fields, { fileName: 'Der Dateiname braucht eine Dateiendung.' });
  assert.equal(both.message, 'Der Dateiname braucht eine Dateiendung.');
});

test('an upload to replace a file starts without asking the database', async () => {
  for (const size of [1, 1.5, MAX_UPLOAD_BYTES]) {
    const response = await DownloadUploadStart(
      request('POST', { fileName: ' Packliste.pdf ', size, replace: true }),
      context
    );
    assert.equal(response.status, 200);
    assert.equal((response.jsonBody as { partSize: number }).partSize, UPLOAD_PART_BYTES);
    assert.match((response.jsonBody as { uploadId: string }).uploadId, /^[A-Za-z0-9_-]{22}$/);
  }
});

test('completing an upload checks name, size and preview in this order', async () => {
  const params = { uploadId: newDownloadKey() };
  const complete = (body: unknown) =>
    DownloadUploadComplete(request('POST', body, params), context);
  const sizeError = 'Die Größe der Datei fehlt. Lade sie noch einmal hoch.';
  const previewError = 'Das Vorschaubild ist kein JPEG oder größer als 2 MB.';

  assert.deepEqual((await rejected(complete({ size: 0, preview: 'AAAA' }))).fields, {
    fileName: NAME_ERROR,
  });
  for (const size of [undefined, '5', 0, -3, 1.5, null]) {
    const answer = await rejected(complete({ fileName: 'a.pdf', size, preview: 'AAAA' }));
    assert.equal(answer.status, 400);
    assert.deepEqual(answer.fields, { size: sizeError });
  }
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString('base64');
  for (const preview of [png, Buffer.alloc(2 * 1024 * 1024 + 1, 0xff).toString('base64')]) {
    const answer = await rejected(complete({ fileName: 'a.pdf', size: 5, preview }));
    assert.equal(answer.status, 400);
    assert.deepEqual(answer.fields, { preview: previewError });
    assert.equal(answer.message, previewError);
  }
});

test('renaming a file checks the name and then the version before the database', async () => {
  const rename = (body: unknown) => DownloadItem(request('PATCH', body, { id: 'x' }), context);
  assert.deepEqual((await rejected(rename({ fileName: 'ohne', etag: '"1"' }))).fields, {
    fileName: 'Der Dateiname braucht eine Dateiendung.',
  });
  assert.deepEqual((await rejected(rename({ etag: '"1"' }))).fields, { fileName: NAME_ERROR });
  const versionless = await rejected(rename({ fileName: ' neu.pdf ' }));
  assert.deepEqual(Object.keys(versionless.fields), ['etag']);
});
