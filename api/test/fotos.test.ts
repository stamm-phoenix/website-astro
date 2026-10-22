import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import {
  FotosFolderEndpoint,
  FotosTargetEndpoint,
  FotosUploadEndpoint,
} from '../endpoints/intern-fotos';
import {
  aktionFotoPath,
  cleanName,
  fotoKind,
  isCleanName,
  numberedName,
  splitFotoPath,
} from '../lib/foto-pfade';
import {
  createFotoUploadSession,
  ensureFotoFolder,
  fotoGraph,
  graphItemPath,
  listFotoFolder,
} from '../lib/fotos';

const NICO = {
  identityProvider: 'aad',
  userId: 'nico',
  userDetails: 'nico.welles@example.test',
  userRoles: ['authenticated', 'team_leitende'],
};

function graphError(statusCode: number): Error {
  return Object.assign(new Error(`Graph ${statusCode}`), { statusCode });
}

/** A library in memory: folders and files by their path, as Graph returns them. */
function fakeLibrary(t: TestContext, paths: Record<string, Record<string, unknown>>) {
  const created: string[] = [];
  const posts: { path: string; body: unknown }[] = [];
  const pathOf = (graphPath: string): string => {
    const match = /root:\/(.*):(?:\/.*)?$/.exec(graphPath);
    return match ? decodeURIComponent(match[1]) : '';
  };
  const item = (path: string): Record<string, unknown> | undefined => {
    const key = Object.keys(paths).find((p) => p.toLowerCase() === path.toLowerCase());
    if (key === undefined) return undefined;
    const parent = key.split('/').slice(0, -1).join('/');
    return {
      name: key.split('/').pop(),
      webUrl: `https://sharepoint.example/Fotos/${key}`,
      parentReference: { path: `/drives/drive-1/root:${parent ? `/${parent}` : ''}` },
      ...paths[key],
    };
  };
  t.mock.method(fotoGraph, 'driveId', async () => 'drive-1');
  t.mock.method(fotoGraph, 'get', async (graphPath: string) => {
    if (graphPath.endsWith('/root'))
      return { name: 'root', folder: {}, webUrl: 'https://sp/Fotos' };
    const found = item(pathOf(graphPath));
    if (!found) throw graphError(404);
    return found;
  });
  t.mock.method(fotoGraph, 'getAll', async (graphPath: string) => {
    const parent = graphPath.endsWith('/root/children') ? '' : pathOf(graphPath);
    return Object.keys(paths)
      .filter((p) => p.split('/').slice(0, -1).join('/') === parent)
      .map((p) => item(p));
  });
  t.mock.method(fotoGraph, 'post', async (graphPath: string, body: Record<string, unknown>) => {
    posts.push({ path: graphPath, body });
    if (graphPath.endsWith('/createUploadSession')) {
      return { uploadUrl: 'https://sharepoint.example/upload?guid=1', expirationDateTime: 'x' };
    }
    const parent = graphPath.endsWith('/root/children') ? '' : pathOf(graphPath);
    const path = parent ? `${parent}/${String(body.name)}` : String(body.name);
    paths[path] = { folder: { childCount: 0 } };
    created.push(path);
    return item(path);
  });
  return { created, posts };
}

function request(
  method: string,
  url: string,
  body?: unknown,
  principal: unknown = NICO
): HttpRequest {
  return new HttpRequest({
    url: `http://localhost/api/intern/fotos/${url}`,
    method,
    headers: {
      'content-type': 'application/json',
      'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64'),
    },
    body: body === undefined ? undefined : { string: JSON.stringify(body) },
  });
}

function context(t: TestContext): InvocationContext {
  const value = new InvocationContext({ functionName: 'fotos-test' });
  t.mock.method(value, 'log', () => undefined);
  return value;
}

test('cleanName keeps usable names and replaces what SharePoint refuses', () => {
  assert.equal(cleanName('Sommerlager Westernohe'), 'Sommerlager Westernohe');
  assert.equal(cleanName('Sola: Westernohe / 2026?'), 'Sola Westernohe 2026');
  assert.equal(cleanName('  ..Hike.  '), 'Hike');
  assert.equal(cleanName('CON'), '');
  assert.equal(cleanName('***'), '');
  const long = cleanName(`${'a'.repeat(200)}.jpeg`);
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('.jpeg'));
});

test('aktionFotoPath builds Aktionen/Jahr/Aktion/Vorname', () => {
  assert.equal(
    aktionFotoPath('2026', 'Sommerlager: Westernohe', 'Nico'),
    'Aktionen/2026/Sommerlager Westernohe/Nico'
  );
  assert.equal(aktionFotoPath('26', 'Sola', 'Nico'), null);
  assert.equal(aktionFotoPath('2026', '???', 'Nico'), null);
});

test('a restart after a lost answer finds the renamed file instead of copying it', async (t) => {
  const library = fakeLibrary(t, {
    'Sola/IMG.jpg': { id: 'a', size: 100, file: {} },
    'Sola/IMG (1).jpg': { id: 'b', size: 200, file: {} },
  });
  assert.deepEqual(await createFotoUploadSession('Sola', 'IMG (1).jpg', 200), {
    exists: true,
    name: 'IMG (1).jpg',
  });
  assert.equal(library.posts.length, 0);
});

test('numberedName keeps long names within the limit', () => {
  assert.equal(numberedName('IMG.jpg', 2), 'IMG (2).jpg');
  const numbered = numberedName(`${'a'.repeat(116)}.jpg`, 1);
  assert.equal(numbered.length, 120);
  assert.ok(numbered.endsWith(' (1).jpg'));
  assert.ok(isCleanName(numbered));
});

test('splitFotoPath accepts stored names and refuses traversal', () => {
  assert.deepEqual(splitFotoPath('2026/Sommerlager  Westernohe'), [
    '2026',
    'Sommerlager  Westernohe',
  ]);
  assert.deepEqual(splitFotoPath(`2026/${'x'.repeat(150)}`), ['2026', 'x'.repeat(150)]);
  assert.equal(splitFotoPath('2026/.'), null);
  assert.equal(splitFotoPath('2026/a:b'), null);
  assert.deepEqual(splitFotoPath(''), []);
  assert.deepEqual(splitFotoPath('2026/Sola'), ['2026', 'Sola']);
  assert.equal(splitFotoPath('2026/../Geheim'), null);
  assert.equal(splitFotoPath('2026//Sola'), null);
  assert.equal(splitFotoPath('2026/Sola/'), null);
});

test('fotoKind knows phone, camera and video formats', () => {
  assert.equal(fotoKind('IMG_0001.HEIC'), 'photo');
  assert.equal(fotoKind('DSC01234.ARW'), 'photo');
  assert.equal(fotoKind('PXL_2026.mp4'), 'video');
  assert.equal(fotoKind('IMG_0002.MOV'), 'video');
  assert.equal(fotoKind('Packliste.pdf'), 'file');
});

test('graphItemPath reads the path below the library root', () => {
  assert.equal(
    graphItemPath({ name: 'Nico', parentReference: { path: '/drives/d/root:/2026/Sola%20Fest' } }),
    '2026/Sola Fest/Nico'
  );
  assert.equal(
    graphItemPath({ name: '2026', parentReference: { path: '/drives/d/root:' } }),
    '2026'
  );
});

test('listFotoFolder sorts folders alphabetically and maps files', async (t) => {
  fakeLibrary(t, {
    '2024': { folder: { childCount: 3 } },
    '2026': { folder: { childCount: 1 } },
    Archiv: { folder: { childCount: 0 } },
    '2026/IMG_10.jpg': {
      id: 'f10',
      size: 10,
      file: { mimeType: 'image/jpeg' },
      photo: { takenDateTime: '2026-07-01T10:00:00Z' },
      thumbnails: [{ large: { url: 'https://thumb/large' }, medium: { url: 'https://thumb/m' } }],
      '@microsoft.graph.downloadUrl': 'https://sharepoint.example/download',
    },
    '2026/IMG_9.jpg': { id: 'f9', size: 9, file: { mimeType: 'image/jpeg' } },
  });

  const root = await listFotoFolder('');
  assert.deepEqual(
    root?.folders.map((f) => f.path),
    ['2024', '2026', 'Archiv']
  );

  const year = await listFotoFolder('2026');
  assert.deepEqual(
    year?.files.map((f) => f.name),
    ['IMG_9.jpg', 'IMG_10.jpg']
  );
  const photo = year?.files[1];
  assert.equal(photo?.thumbnailUrl, 'https://thumb/large');
  assert.equal(photo?.downloadUrl, 'https://sharepoint.example/download');
  assert.equal(photo?.takenAt, '2026-07-01T10:00:00Z');
  assert.equal(photo?.kind, 'photo');

  assert.equal(await listFotoFolder('2025'), undefined);
});

test('folders are alphabetical on every level, with umlauts and numbers in place', async (t) => {
  fakeLibrary(t, {
    'Aktionen/2025': { folder: {} },
    'Aktionen/2025/Winterwochenende': { folder: {} },
    'Aktionen/2025/Schwedenfahrt 2025': { folder: {} },
    'Aktionen/2025/Ölmühle': { folder: {} },
    'Aktionen/2025/Lager 10': { folder: {} },
    'Aktionen/2025/Lager 2': { folder: {} },
    'Aktionen/2025/ausflug': { folder: {} },
  });
  const year = await listFotoFolder('Aktionen/2025');
  assert.deepEqual(
    year?.folders.map((f) => f.name),
    ['ausflug', 'Lager 2', 'Lager 10', 'Ölmühle', 'Schwedenfahrt 2025', 'Winterwochenende']
  );
});

test('ensureFotoFolder creates only the missing folders and keeps existing names', async (t) => {
  const library = fakeLibrary(t, { '2026': { folder: {} }, '2026/Sommerlager': { folder: {} } });

  const result = await ensureFotoFolder('2026/sommerlager/Nico');

  assert.deepEqual(library.created, ['2026/Sommerlager/Nico']);
  assert.equal(result.path, '2026/Sommerlager/Nico');
  assert.equal(result.webUrl, 'https://sharepoint.example/Fotos/2026/Sommerlager/Nico');
});

test('ensureFotoFolder refuses a file in the way', async (t) => {
  fakeLibrary(t, { '2026': { file: {}, id: 'x' } });
  await assert.rejects(ensureFotoFolder('2026/Sola'), { name: 'FotoPathConflictError' });
});

test('createFotoUploadSession skips a file of the same name and size', async (t) => {
  const library = fakeLibrary(t, {
    '2026/Sola/Nico': { folder: {} },
    '2026/Sola/Nico/IMG_1.jpg': { id: 'f1', size: 100, file: {} },
  });

  assert.deepEqual(await createFotoUploadSession('2026/Sola/Nico', 'IMG_1.jpg', 100), {
    exists: true,
    name: 'IMG_1.jpg',
  });
  assert.equal(library.posts.length, 0);

  const session = await createFotoUploadSession('2026/Sola/Nico', 'IMG_1.jpg', 200);
  assert.equal(session.exists, false);
  assert.equal(session.name, 'IMG_1 (1).jpg');
  assert.deepEqual(library.posts[0].body, {
    item: { '@microsoft.graph.conflictBehavior': 'fail' },
  });
  assert.match(
    library.posts[0].path,
    /root:\/2026\/Sola\/Nico\/IMG_1%20\(1\)\.jpg:\/createUploadSession$/
  );
});

test('the Aktion target is the folder of the logged-in person', async (t) => {
  const library = fakeLibrary(t, {});
  const response = await FotosTargetEndpoint(
    request('POST', 'ziel', { jahr: '2026', aktion: 'Sommerlager Westernohe' }),
    context(t)
  );
  assert.equal(response.status, 200);
  assert.equal(
    (response.jsonBody as { path: string }).path,
    'Aktionen/2026/Sommerlager Westernohe/Nico'
  );
  assert.deepEqual(library.created, [
    'Aktionen',
    'Aktionen/2026',
    'Aktionen/2026/Sommerlager Westernohe',
    'Aktionen/2026/Sommerlager Westernohe/Nico',
  ]);
  const name = await FotosTargetEndpoint(request('GET', 'ziel'), context(t));
  assert.deepEqual(name.jsonBody, { vorname: 'Nico' });
});

test('a free target needs a folder below the top level', async (t) => {
  fakeLibrary(t, {});
  const top = await FotosTargetEndpoint(request('POST', 'ziel', { pfad: '' }), context(t));
  assert.equal(top.status, 400);

  const sub = await FotosTargetEndpoint(
    request('POST', 'ziel', { pfad: '', unterordner: 'Archiv' }),
    context(t)
  );
  assert.equal(sub.status, 200);
  assert.equal((sub.jsonBody as { path: string }).path, 'Archiv');
});

test('the upload refuses other files and invalid names', async (t) => {
  fakeLibrary(t, { '2026': { folder: {} } });
  const upload = (body: unknown) =>
    FotosUploadEndpoint(request('POST', 'upload', body), context(t));

  assert.equal((await upload({ pfad: '2026', name: 'Liste.pdf', size: 5 })).status, 400);
  assert.equal((await upload({ pfad: '2026', name: 'a:b.jpg', size: 5 })).status, 400);
  assert.equal((await upload({ pfad: '2026', name: 'a.jpg', size: 0 })).status, 400);
  assert.equal((await upload({ pfad: '../x', name: 'a.jpg', size: 5 })).status, 400);
  assert.equal((await upload({ pfad: '2026', name: 'a.jpg', size: 5 })).status, 200);
});

test('the folder list needs a login and answers 404 for a missing folder', async (t) => {
  fakeLibrary(t, {});
  const anonymous = await FotosFolderEndpoint(
    request('GET', 'ordner?pfad=2026', undefined, { identityProvider: 'github' }),
    context(t)
  );
  assert.equal(anonymous.status, 401);

  const missing = await FotosFolderEndpoint(request('GET', 'ordner?pfad=2026'), context(t));
  assert.equal(missing.status, 404);
});

test('a free target whose whole path is too long is refused before SharePoint', async (t) => {
  const library = fakeLibrary(t, {});
  const response = await FotosTargetEndpoint(
    request('POST', 'ziel', {
      pfad: `${'a'.repeat(200)}/${'b'.repeat(100)}`,
      unterordner: 'c'.repeat(100),
    }),
    context(t)
  );
  assert.equal(response.status, 400);
  assert.equal(library.created.length, 0);
});

test('a numbered file of the same size is another photo, not this one', async (t) => {
  const library = fakeLibrary(t, {
    'Sola/IMG.jpg': { id: 'a', size: 100, file: {} },
    'Sola/IMG (1).jpg': { id: 'b', size: 200, file: {} },
  });
  const session = await createFotoUploadSession('Sola', 'IMG.jpg', 200);
  assert.equal(session.exists, false);
  assert.equal(session.name, 'IMG (2).jpg');
  assert.equal(library.posts.length, 1);
});

test('a new name never takes over the file of another upload of the batch', async (t) => {
  const library = fakeLibrary(t, {
    'Sola/IMG.jpg': { id: 'a', size: 100, file: {} },
    'Sola/IMG (1).jpg': { id: 'b', size: 200, file: {} },
  });
  const session = await createFotoUploadSession('Sola', 'IMG (1).jpg', 200, { newName: true });
  assert.equal(session.exists, false);
  assert.equal(session.name, 'IMG (1) (1).jpg');
  assert.equal(library.posts.length, 1);
});

test('names held by other files of the upload are skipped, even before they arrive', async (t) => {
  fakeLibrary(t, { 'Sola/IMG.jpg': { id: 'a', size: 100, file: {} } });
  const session = await createFotoUploadSession('Sola', 'IMG.jpg', 200, {
    reserved: ['img (1).jpg'],
  });
  assert.equal(session.name, 'IMG (2).jpg');
});

test('a file whose whole path is too long is refused before SharePoint', async (t) => {
  const library = fakeLibrary(t, {});
  const folder = ['a'.repeat(120), 'b'.repeat(120), 'c'.repeat(60)].join('/');
  const response = await FotosUploadEndpoint(
    request('POST', 'upload', { pfad: folder, name: `${'d'.repeat(116)}.jpg`, size: 10 }),
    context(t)
  );
  assert.equal(response.status, 400);
  assert.equal(library.posts.length, 0);
});

test('shortening keeps emoji whole', () => {
  const cleaned = cleanName(`${'a'.repeat(115)}😀.jpg`);
  assert.ok(isCleanName(cleaned));
  assert.doesNotThrow(() => encodeURIComponent(cleaned));
  const numbered = numberedName(`${'a'.repeat(111)}😀.jpg`, 1);
  assert.ok(numbered.length <= 120);
  assert.doesNotThrow(() => encodeURIComponent(numbered));
});

test('shortening never leaves a dot or space at the end', () => {
  for (const name of [`${'a'.repeat(119)}.bbbbbbbbb`, `${'a'.repeat(118)} .bbbbbbbbb`]) {
    const cleaned = cleanName(name);
    assert.ok(cleaned.length <= 120);
    assert.ok(isCleanName(cleaned), cleaned);
  }
});
