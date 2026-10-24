import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { Client } from '@microsoft/microsoft-graph-client';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { FotosNoteEndpoint } from '../endpoints/intern-fotos';
import {
  fotoMail,
  fotoMailContent,
  fotoOrdnerTitel,
  sendFotoBenachrichtigung,
} from '../lib/foto-benachrichtigung';
import { fotoAnzahlText, fotoOrdnerLink } from '../lib/foto-pfade';
import { fotoGraph, type FotoFile } from '../lib/fotos';
import { audienceVersion } from '../lib/protokolle';
import * as token from '../lib/token';

const NICO = {
  identityProvider: 'aad',
  userId: 'nico',
  userDetails: 'nico.welles@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};

const RECIPIENTS = [
  { email: 'anna@example.test', name: 'Anna', reasons: ['Gruppe Leiter*in'] },
  { email: 'ben@example.test', name: 'Ben', reasons: ['Gruppe Leiter*in'] },
];

function file(name: string, id = name): FotoFile {
  return {
    id,
    name,
    size: 1,
    kind: /\.mp4$/.test(name) ? 'video' : 'photo',
    thumbnailUrl: null,
    takenAt: null,
    modifiedAt: null,
    width: null,
    height: null,
    durationMs: null,
    webUrl: '',
    downloadUrl: null,
  };
}

function request(body: unknown): HttpRequest {
  return new HttpRequest({
    url: 'http://localhost/api/intern/fotos/benachrichtigung',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ms-client-principal': Buffer.from(JSON.stringify(NICO)).toString('base64'),
    },
    body: { string: JSON.stringify(body) },
  });
}

function context(t: TestContext): InvocationContext {
  const value = new InvocationContext({ functionName: 'fotos-test' });
  t.mock.method(value, 'log', () => undefined);
  return value;
}

/** A folder `Aktionen/2026/Sola/Nico` with three files. */
function fakeFolder(t: TestContext): void {
  t.mock.method(fotoGraph, 'driveId', async () => 'drive-1');
  t.mock.method(fotoGraph, 'get', async () => ({
    name: 'Nico',
    folder: {},
    webUrl: 'https://sp/Fotos/Aktionen/2026/Sola/Nico',
    parentReference: { path: '/drives/drive-1/root:/Aktionen/2026/Sola' },
  }));
  t.mock.method(fotoGraph, 'getAll', async () =>
    ['IMG_1.jpg', 'IMG_2.jpg', 'Clip.mp4'].map((name) => ({
      id: `id-${name}`,
      name,
      file: {},
      size: 10,
    }))
  );
}

test('fotoAnzahlText counts photos and videos in plain German', () => {
  assert.equal(fotoAnzahlText([file('a.jpg')]), '1 neues Foto');
  assert.equal(fotoAnzahlText([file('a.jpg'), file('b.heic')]), '2 neue Fotos');
  assert.equal(
    fotoAnzahlText([file('a.jpg'), file('b.jpg'), file('c.mp4')]),
    '2 neue Fotos und 1 neues Video'
  );
  assert.equal(
    fotoAnzahlText([file('a.jpg'), file('b.jpg'), file('c.pdf')]),
    '2 neue Fotos und 1 neue Datei'
  );
});

test('fotoOrdnerTitel names the last two levels of the folder', () => {
  assert.equal(fotoOrdnerTitel('Aktionen/2026/Sola/Nico'), 'Sola / Nico');
  assert.equal(fotoOrdnerTitel('Gruppenstunden'), 'Gruppenstunden');
});

test('fotoOrdnerLink opens the folder like the page itself', () => {
  assert.equal(
    fotoOrdnerLink('Aktionen/2026/Sola & Hike'),
    '/leitendenbereich/fotos#pfad=Aktionen%2F2026%2FSola+%26+Hike'
  );
});

test('the mail names person, number and folder and shows the previews inline', () => {
  const { subject, html } = fotoMailContent(
    {
      person: 'Nico',
      path: 'Aktionen/2026/Sola/Nico',
      files: [file('a.jpg'), file('b.jpg'), file('<c>.jpg')],
      url: 'https://www.stamm-phoenix.de/leitendenbereich/fotos#pfad=x',
    },
    [{ contentId: 'foto-1@x', name: '<c>.jpg' }]
  );
  assert.equal(subject, 'Nico hat 3 neue Fotos hochgeladen: Sola / Nico');
  assert.match(html, /<strong>Nico<\/strong> hat 3 neue Fotos in den Ordner/);
  assert.match(html, /src="cid:foto-1@x"/);
  assert.match(html, /alt="&lt;c&gt;.jpg"/);
  assert.match(html, /und 2 weitere/);
  assert.match(html, /href="https:\/\/www.stamm-phoenix.de\/leitendenbereich\/fotos#pfad=x"/);
});

test('sendFotoBenachrichtigung embeds the previews it gets and skips missing ones', async (t) => {
  t.mock.method(fotoGraph, 'driveId', async () => 'drive-1');
  t.mock.method(fotoGraph, 'get', async (path: string) => {
    if (path.includes('/items/b/')) return { value: [{}] };
    return { value: [{ c240x240_crop: { url: `https://preview/${path}` } }] };
  });
  t.mock.method(fotoGraph, 'download', async () => ({
    contentType: 'image/jpeg',
    content: new Uint8Array([1, 2, 3]),
  }));
  let message: Record<string, unknown> | undefined;
  t.mock.method(
    token,
    'getClient',
    () =>
      ({
        api: () => ({
          post: async (body: { message: Record<string, unknown> }) => {
            message = body.message;
          },
        }),
      }) as unknown as Client
  );
  await sendFotoBenachrichtigung(['anna@example.test'], {
    person: 'Nico',
    replyTo: 'nico.welles@example.test',
    path: 'Aktionen/2026/Sola/Nico',
    files: [file('a.jpg', 'a'), file('b.jpg', 'b'), file('c.mp4', 'c')],
    url: 'https://www.stamm-phoenix.de/leitendenbereich/fotos#pfad=x',
  });
  const attachments = message?.attachments as Record<string, unknown>[];
  assert.equal(attachments.length, 2);
  assert.deepEqual(
    attachments.map((a) => [a.contentId, a.isInline]),
    [
      ['foto-1@stamm-phoenix.de', true],
      ['foto-2@stamm-phoenix.de', true],
    ]
  );
  assert.deepEqual(message?.bccRecipients, [{ emailAddress: { address: 'anna@example.test' } }]);
  assert.deepEqual(message?.replyTo, [
    { emailAddress: { address: 'nico.welles@example.test', name: 'Nico' } },
  ]);
  assert.match(String((message?.body as { content: string }).content), /cid:foto-2@/);
});

test('the note goes to the confirmed list and names only files in the folder', async (t) => {
  fakeFolder(t);
  t.mock.method(fotoMail, 'recipients', async () => RECIPIENTS);
  const sent: { to: string[]; data: Parameters<typeof fotoMail.send>[1] }[] = [];
  t.mock.method(fotoMail, 'send', async (to: string[], data: (typeof sent)[number]['data']) => {
    sent.push({ to, data });
  });
  const response = await FotosNoteEndpoint(
    request({
      action: 'send',
      pfad: 'Aktionen/2026/Sola/Nico',
      dateien: ['img_1.jpg', 'Clip.mp4', 'Weg.jpg'],
      version: audienceVersion(RECIPIENTS),
      excluded: ['ben@example.test'],
      extra: ['gast@example.test'],
    }),
    context(t)
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { recipients: 2, files: 2 });
  assert.deepEqual(sent[0].to, ['anna@example.test', 'gast@example.test']);
  assert.deepEqual(
    sent[0].data.files.map((f) => f.name),
    ['IMG_1.jpg', 'Clip.mp4']
  );
  assert.equal(sent[0].data.person, 'Nico');
  assert.equal(sent[0].data.replyTo, 'nico.welles@example.test');
  assert.equal(
    sent[0].data.url,
    'http://localhost/leitendenbereich/fotos#pfad=Aktionen%2F2026%2FSola%2FNico'
  );
});

test('the note is refused for a changed list or an empty choice, and nothing is sent', async (t) => {
  fakeFolder(t);
  t.mock.method(fotoMail, 'recipients', async () => RECIPIENTS);
  const send = t.mock.method(fotoMail, 'send', async () => undefined);
  const base = { action: 'send', pfad: 'Aktionen/2026/Sola/Nico', dateien: ['IMG_1.jpg'] };

  const changed = await FotosNoteEndpoint(request({ ...base, version: 'alt' }), context(t));
  assert.equal(changed.status, 400);

  const nobody = await FotosNoteEndpoint(
    request({
      ...base,
      version: audienceVersion(RECIPIENTS),
      excluded: RECIPIENTS.map((r) => r.email),
    }),
    context(t)
  );
  assert.equal(nobody.status, 400);

  const gone = await FotosNoteEndpoint(
    request({ ...base, dateien: ['Weg.jpg'], version: audienceVersion(RECIPIENTS) }),
    context(t)
  );
  assert.equal(gone.status, 400);

  const noFiles = await FotosNoteEndpoint(
    request({ ...base, dateien: [], version: audienceVersion(RECIPIENTS) }),
    context(t)
  );
  assert.equal(noFiles.status, 400);
  assert.equal(send.mock.callCount(), 0);
});
