import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { sql } from 'kysely';
import sharp from 'sharp';
import * as blobStorage from '../lib/blob-storage';
import { createDatabase, getDb, inTransaction, useDatabase } from '../lib/db';
import { seedPreviewGruppenstunden, seedPreviewLeitende } from '../lib/db-preview';
import { getGruppenstunden, getStaffGruppenstunden } from '../lib/gruppenstunden-list';
import {
  ORPHAN_MIN_AGE_MS,
  getLeitende,
  getStaffLeitende,
  updateLeitende,
} from '../lib/leitende-list';
import { GetGruppenstundenEndpoint } from '../endpoints/gruppenstunden';
import { GetLeitendeImage } from '../endpoints/image';
import { GetVorstandEndpoint } from '../endpoints/vorstand';
import {
  GruppenstundeItem,
  GruppenstundenCollection,
} from '../endpoints/intern-pflege-gruppenstunden';
import {
  LeitendeCollection,
  LeitendeItem,
  LeitendePhoto,
} from '../endpoints/intern-pflege-leitende';
import { dbTest, target } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

/** Blob Storage in memory and a quiet context. */
function setup(t: TestContext): {
  context: InvocationContext;
  blobs: Map<string, Buffer>;
  times: Map<string, Date>;
} {
  const blobs = new Map<string, Buffer>();
  const times = new Map<string, Date>();
  t.mock.method(blobStorage, 'putBlob', async (name: string, bytes: Uint8Array) => {
    blobs.set(name, Buffer.from(bytes));
    times.set(name, new Date());
  });
  t.mock.method(blobStorage, 'listBlobs', async (prefix: string) =>
    [...blobs.keys()]
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({ name, lastModified: times.get(name) ?? new Date() }))
  );
  t.mock.method(blobStorage, 'getBlob', async (name: string) => blobs.get(name));
  t.mock.method(blobStorage, 'deleteBlob', async (name: string) => {
    blobs.delete(name);
  });
  t.mock.method(blobStorage, 'deleteBlobs', async (prefix: string) => {
    const names = [...blobs.keys()].filter((name) => name.startsWith(prefix));
    for (const name of names) blobs.delete(name);
    return names.length;
  });
  t.mock.method(console, 'info', () => undefined);
  t.mock.method(console, 'warn', () => undefined);
  const context = new InvocationContext({ functionName: 'leitende-test' });
  t.mock.method(context, 'log', () => undefined);
  t.mock.method(context, 'error', () => undefined);
  return { context, blobs, times };
}

function request(
  method: string,
  params: Record<string, string> = {},
  body?: unknown,
  etag?: string
): HttpRequest {
  const headers: Record<string, string> = {
    'x-ms-client-principal': Buffer.from(JSON.stringify(PRINCIPAL)).toString('base64'),
  };
  if (etag) headers['if-match'] = etag;
  let init: { string: string } | { bytes: Uint8Array } | undefined;
  if (body instanceof Uint8Array) {
    headers['content-type'] = 'image/jpeg';
    init = { bytes: body };
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init = { string: JSON.stringify(body) };
  }
  return new HttpRequest({ url: 'http://localhost/api/test', method, headers, params, body: init });
}

function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#003056' } })
    .jpeg()
    .toBuffer();
}

const GRUPPENSTUNDE = {
  stufe: 'Wölflinge',
  weekday: 'Montags',
  time: '17:00 Uhr',
  ageRange: '7 – 10 Jahre',
  location: 'Pfarrheim',
  description: '<p>Spielen</p>',
};

dbTest('Gruppenstunden are changed and deleted only in the loaded version', async (t) => {
  const { context } = setup(t);
  const created = await GruppenstundenCollection(request('POST', {}, GRUPPENSTUNDE), context);
  assert.equal(created.status, 201);
  const { id } = created.jsonBody as { id: string };

  const list = await GruppenstundenCollection(request('GET'), context);
  const [item] = (list.jsonBody as { items: { id: string; etag: string; leitende: [] }[] }).items;
  assert.equal(item.id, id);
  assert.deepEqual(item.leitende, []);

  const changed = { ...GRUPPENSTUNDE, location: 'Wald', etag: item.etag };
  assert.equal((await GruppenstundeItem(request('PATCH', { id }, changed), context)).status, 204);
  // The same old version again is a conflict, also for deleting
  assert.equal((await GruppenstundeItem(request('PATCH', { id }, changed), context)).status, 409);
  assert.equal(
    (await GruppenstundeItem(request('DELETE', { id }, undefined, item.etag), context)).status,
    409
  );
  // A version of a SharePoint item (open dialog across the deploy) is a conflict too
  const legacy = { ...changed, etag: '"5b2c3f1e-1d2c-4b3a-9f8e-7d6c5b4a3f21,3"' };
  assert.equal((await GruppenstundeItem(request('PATCH', { id }, legacy), context)).status, 409);

  const [current] = await getStaffGruppenstunden();
  assert.equal(current.location, 'Wald');
  assert.equal(
    (await GruppenstundeItem(request('DELETE', { id }, undefined, current.etag), context)).status,
    204
  );
  assert.equal(
    (await GruppenstundeItem(request('DELETE', { id }, undefined, current.etag), context)).status,
    404
  );
});

dbTest('Leitende are kept with their teams and photo', async (t) => {
  const { context, blobs } = setup(t);
  const person = {
    name: 'Vera Vorstand',
    teams: ['Vorstand', 'Wölflinge'],
    phone: '0123 456',
    street: 'Hauptstraße 1',
    postalCode: '12345',
    city: 'Musterstadt',
  };
  const created = await LeitendeCollection(request('POST', {}, person), context);
  assert.equal(created.status, 201);
  const { id } = created.jsonBody as { id: string };

  const unknownTeam = await LeitendeCollection(
    request('POST', {}, { ...person, teams: ['Geheimbund'] }),
    context
  );
  assert.equal(unknownTeam.status, 400);

  let [stored] = await getStaffLeitende();
  assert.deepEqual(stored.teams, ['Vorstand', 'Wölflinge']);

  // Leaving the Vorstand drops the contact details
  const patch = { ...person, teams: ['Rover'], etag: stored.etag };
  assert.equal((await LeitendeItem(request('PATCH', { id }, patch), context)).status, 204);
  assert.equal((await LeitendeItem(request('PATCH', { id }, patch), context)).status, 409);
  [stored] = await getStaffLeitende();
  assert.deepEqual(
    [stored.teams, stored.phone, stored.street, stored.postalCode, stored.city],
    [['Rover'], '', '', '', '']
  );

  // A photo needs the current version and changes it
  const photo = new Uint8Array(await jpeg(600, 600));
  const stale = await LeitendePhoto(request('PUT', { id }, photo, patch.etag), context);
  assert.equal(stale.status, 409);
  const uploaded = await LeitendePhoto(request('PUT', { id }, photo, stored.etag), context);
  assert.equal(uploaded.status, 200);
  const [withPhoto] = await getStaffLeitende();
  assert.equal((uploaded.jsonBody as { etag: string }).etag, withPhoto.etag);
  assert.equal(withPhoto.hasImage, true);
  assert.notEqual(withPhoto.etag, stored.etag);
  const names = [...blobs.keys()];
  assert.equal(names.length, 1);
  assert.match(names[0], new RegExp(`^leitende/${id}/foto-\\d+\\.jpg$`));
  const meta = await sharp(blobs.get(names[0])).metadata();
  assert.deepEqual([meta.width, meta.height], [300, 300]);
  assert.equal((await GetLeitendeImage(request('GET', { id }), context)).status, 200);

  const notJpeg = await LeitendePhoto(
    request('PUT', { id }, new Uint8Array([1, 2, 3]), withPhoto.etag),
    context
  );
  assert.equal(notJpeg.status, 400);

  const removed = await LeitendePhoto(
    request('DELETE', { id }, undefined, withPhoto.etag),
    context
  );
  assert.equal(removed.status, 200);
  assert.equal(blobs.size, 0);
  const [withoutPhoto] = await getStaffLeitende();
  assert.equal((removed.jsonBody as { etag: string }).etag, withoutPhoto.etag);
  assert.equal(withoutPhoto.hasImage, false);

  await LeitendePhoto(request('PUT', { id }, photo, withoutPhoto.etag), context);
  const [latest] = await getStaffLeitende();
  const deleted = await LeitendeItem(request('DELETE', { id }, undefined, latest.etag), context);
  assert.equal(deleted.status, 204);
  assert.equal(blobs.size, 0);
  assert.deepEqual(await getStaffLeitende(), []);
  const teams = await getDb().selectFrom('content.leitende_team').selectAll().execute();
  assert.deepEqual(teams, []);
});

dbTest('the public pages show the edited Gruppenstunden and Leitende', async (t) => {
  const { context, blobs } = setup(t);
  for (const stufe of ['Rover', 'Wölflinge']) {
    const created = await GruppenstundenCollection(
      request('POST', {}, { ...GRUPPENSTUNDE, stufe }),
      context
    );
    assert.equal(created.status, 201);
  }
  assert.deepEqual(
    (await getGruppenstunden()).map((item) => [item.id, item.stufe, item.weekday, item.location]),
    [
      ['1', 'Rover', 'Montags', 'Pfarrheim'],
      ['2', 'Wölflinge', 'Montags', 'Pfarrheim'],
    ]
  );
  const gruppenstunden = await GetGruppenstundenEndpoint();
  assert.equal(gruppenstunden.status, 200);
  assert.equal((gruppenstunden.jsonBody as unknown[]).length, 2);

  const vorstand = {
    name: 'Vera Vorstand',
    teams: ['Vorstand', 'Wölflinge'],
    phone: '0123 456',
    street: 'Hauptstraße 1',
    postalCode: '12345',
    city: 'Musterstadt',
  };
  await LeitendeCollection(request('POST', {}, vorstand), context);
  await LeitendeCollection(request('POST', {}, { name: 'Rudi Rover', teams: ['Rover'] }), context);
  const [vera] = (await getStaffLeitende()).filter((person) => person.name === 'Vera Vorstand');
  const photo = new Uint8Array(await jpeg(600, 600));
  await LeitendePhoto(request('PUT', { id: vera.id }, photo, vera.etag), context);

  const leitende = await getLeitende();
  const withPhoto = leitende.find((person) => person.name === 'Vera Vorstand');
  assert.deepEqual(
    [withPhoto?.teams, withPhoto?.telephone, withPhoto?.street, withPhoto?.city],
    [['Vorstand', 'Wölflinge'], '0123 456', 'Hauptstraße 1', '12345 Musterstadt']
  );
  assert.deepEqual([...blobs.keys()], [`leitende/${vera.id}/${withPhoto?.imageFileName}`]);
  assert.ok(leitende.some((person) => person.name === 'Rudi Rover'));
  const publicVorstand = await GetVorstandEndpoint();
  assert.deepEqual(
    (publicVorstand.jsonBody as { name: string }[]).map((person) => person.name),
    ['Vera Vorstand']
  );
});

dbTest('the preview gets invented Gruppenstunden and Leitende once', async (t) => {
  const { blobs } = setup(t);
  await seedPreviewGruppenstunden();
  await seedPreviewLeitende();
  const gruppenstunden = await getStaffGruppenstunden();
  const leitende = await getStaffLeitende();
  assert.deepEqual(
    gruppenstunden.map((item) => item.stufe),
    ['Wölflinge', 'Jungpfadfinder', 'Pfadfinder', 'Rover']
  );
  assert.equal(leitende.length, 7);
  const photos = leitende.filter((person) => person.hasImage).length;
  assert.equal(photos, 4);
  assert.equal(blobs.size, 4);

  await seedPreviewGruppenstunden();
  await seedPreviewLeitende();
  assert.equal((await getStaffGruppenstunden()).length, 4);
  assert.equal((await getStaffLeitende()).length, 7);
  assert.equal(blobs.size, 4);
});

dbTest('new entries work with the rights of the website', async (t) => {
  const { context } = setup(t);

  // The website only reads and writes data (docs/azure-sql.md): a user with just these roles
  const database = (await sql<{ name: string }>`SELECT DB_NAME() AS name`.execute(getDb())).rows[0]
    .name;
  const login = `website_${randomBytes(4).toString('hex')}`;
  const password = `Web_${randomBytes(8).toString('hex')}!`;
  const master = createDatabase(target('master'));
  try {
    await sql.raw(`CREATE LOGIN [${login}] WITH PASSWORD = '${password}'`).execute(master);
  } finally {
    await master.destroy();
  }
  await sql
    .raw(
      `CREATE USER [${login}] FOR LOGIN [${login}];
       ALTER ROLE db_datareader ADD MEMBER [${login}];
       ALTER ROLE db_datawriter ADD MEMBER [${login}];`
    )
    .execute(getDb());

  const closeWebsite = useDatabase({
    ...target(database),
    authentication: { type: 'default', options: { userName: login, password } },
  });
  try {
    const created = await LeitendeCollection(
      request('POST', {}, { name: 'Neu', teams: ['Vorstand'] }),
      context
    );
    assert.deepEqual(created.jsonBody, { id: '1' });
    const gruppenstunde = await GruppenstundenCollection(
      request('POST', {}, { ...GRUPPENSTUNDE, stufe: 'Pfadfinder' }),
      context
    );
    assert.deepEqual(gruppenstunde.jsonBody, { id: '1' });
  } finally {
    await closeWebsite();
    useDatabase(target(database));
    await sql.raw(`DROP USER [${login}]`).execute(getDb());
    const cleanup = createDatabase(target('master'));
    try {
      await sql.raw(`DROP LOGIN [${login}]`).execute(cleanup);
    } finally {
      await cleanup.destroy();
    }
  }
});

dbTest('concurrent photo uploads at the same moment keep the saved photo', async (t) => {
  const { context, blobs } = setup(t);
  const created = await LeitendeCollection(
    request('POST', {}, { name: 'Vera', teams: ['Wölflinge'] }),
    context
  );
  const { id } = created.jsonBody as { id: string };
  const [person] = await getStaffLeitende();
  t.mock.method(Date, 'now', () => 1_700_000_000_000);
  const photo = new Uint8Array(await jpeg(600, 600));
  const responses = await Promise.all([
    LeitendePhoto(request('PUT', { id }, photo, person.etag), context),
    LeitendePhoto(request('PUT', { id }, photo, person.etag), context),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const stored = await getDb()
    .selectFrom('content.leitende')
    .select('photo')
    .where('id', '=', Number(id))
    .executeTakeFirstOrThrow();
  assert.match(stored.photo ?? '', /^foto-\d+\.jpg$/);
  assert.deepEqual([...blobs.keys()], [`leitende/${id}/${stored.photo}`]);
  assert.equal((await GetLeitendeImage(request('GET', { id }), context)).status, 200);
});

dbTest('a person is read with the teams of the same version', async (t) => {
  const { context } = setup(t);
  await LeitendeCollection(request('POST', {}, { name: 'Vera', teams: ['Wölflinge'] }), context);
  const [before] = await getStaffLeitende();
  const input = { name: 'Vera', teams: ['Rover'], phone: '', street: '', postalCode: '', city: '' };

  // A save in progress: readers see the old version with the old teams
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  let changed = (): void => undefined;
  const inProgress = new Promise<void>((resolve) => (changed = resolve));
  const save = inTransaction(async (trx) => {
    await trx
      .updateTable('content.leitende')
      .set({ name: 'Vera', updated_at: sql<Date>`SYSUTCDATETIME()` })
      .where('id', '=', Number(before.id))
      .execute();
    await trx
      .updateTable('content.leitende_team')
      .set({ team: 'Rover' })
      .where('leitende_id', '=', Number(before.id))
      .execute();
    changed();
    await held;
  });
  await inProgress;
  const during = await getStaffLeitende();
  assert.deepEqual([during[0].etag, during[0].teams], [before.etag, ['Wölflinge']]);
  release();
  await save;

  const [after] = await getStaffLeitende();
  assert.notEqual(after.etag, before.etag);
  assert.deepEqual(after.teams, ['Rover']);
  // The old version cannot overwrite the new teams
  await assert.rejects(
    updateLeitende(Number(before.id), { ...input, teams: ['Wölflinge'] }, before.etag, 'x'),
    { name: 'VersionConflictError' }
  );
});

dbTest('the ID of a deleted person is never given to a new one', async (t) => {
  const { context, blobs } = setup(t);
  const first = await LeitendeCollection(
    request('POST', {}, { name: 'Alt', teams: ['Rover'] }),
    context
  );
  const oldId = (first.jsonBody as { id: string }).id;
  const [old] = await getStaffLeitende();
  const photo = new Uint8Array(await jpeg(600, 600));
  await LeitendePhoto(request('PUT', { id: oldId }, photo, old.etag), context);
  const [withPhoto] = await getStaffLeitende();

  // The deletion lists the files of the person slowly; meanwhile someone adds a new person
  const original = (blobStorage.deleteBlobs as unknown as { mock: { restore(): void } }).mock;
  original.restore();
  let release = (): void => undefined;
  const listed = new Promise<void>((resolve) => (release = resolve));
  t.mock.method(blobStorage, 'deleteBlobs', async (prefix: string) => {
    const names = [...blobs.keys()].filter((name) => name.startsWith(prefix));
    await listed;
    for (const name of names) blobs.delete(name);
    return names.length;
  });
  const deletion = LeitendeItem(
    request('DELETE', { id: oldId }, undefined, withPhoto.etag),
    context
  );
  await new Promise((resolve) => setImmediate(resolve));
  while ((await getStaffLeitende()).length > 0) await new Promise((r) => setTimeout(r, 10));

  const second = await LeitendeCollection(
    request('POST', {}, { name: 'Neu', teams: ['Rover'] }),
    context
  );
  const newId = (second.jsonBody as { id: string }).id;
  assert.notEqual(newId, oldId);
  const [person] = await getStaffLeitende();
  await LeitendePhoto(request('PUT', { id: newId }, photo, person.etag), context);
  release();
  assert.equal((await deletion).status, 204);

  assert.equal((await GetLeitendeImage(request('GET', { id: newId }), context)).status, 200);
  assert.deepEqual(
    [...blobs.keys()].map((name) => name.split('/')[1]),
    [newId]
  );
});

dbTest('photos of a deleted person are removed later when the first cleanup fails', async (t) => {
  const { context, blobs, times } = setup(t);
  const photo = new Uint8Array(await jpeg(600, 600));
  const ids: string[] = [];
  for (const name of ['Alt', 'Neu']) {
    const created = await LeitendeCollection(
      request('POST', {}, { name, teams: ['Rover'] }),
      context
    );
    const id = (created.jsonBody as { id: string }).id;
    const person = (await getStaffLeitende()).find((candidate) => candidate.id === id);
    await LeitendePhoto(request('PUT', { id }, photo, person?.etag), context);
    ids.push(id);
  }
  const [oldId, newId] = ids;
  const oldFile = [...blobs.keys()].find((name) => name.startsWith(`leitende/${oldId}/`)) ?? '';

  // The storage fails while the person is deleted: the deletion is saved anyway
  (blobStorage.deleteBlobs as unknown as { mock: { restore(): void } }).mock.restore();
  t.mock.method(blobStorage, 'deleteBlobs', async () => {
    throw new Error('Blob Storage unavailable');
  });
  const old = (await getStaffLeitende()).find((person) => person.id === oldId);
  const deleted = await LeitendeItem(
    request('DELETE', { id: oldId }, undefined, old?.etag),
    context
  );
  assert.equal(deleted.status, 204);
  assert.ok(blobs.has(oldFile));

  // A later change removes the file once it is old enough to belong to no upload in progress
  times.set(oldFile, new Date(Date.now() - ORPHAN_MIN_AGE_MS - 1000));
  const current = (await getStaffLeitende()).find((person) => person.id === newId);
  await LeitendePhoto(request('PUT', { id: newId }, photo, current?.etag), context);
  assert.equal(blobs.has(oldFile), false);
  assert.deepEqual(
    [...blobs.keys()].map((name) => name.split('/')[1]),
    [newId]
  );
  assert.equal((await GetLeitendeImage(request('GET', { id: newId }), context)).status, 200);
});

for (const operation of ['PUT', 'DELETE'] as const) {
  dbTest(
    `photo ${operation} returns its own version when another editor writes during cleanup`,
    async (t) => {
      const { context, blobs } = setup(t);
      const created = await LeitendeCollection(
        request('POST', {}, { name: 'Vera', teams: ['Wölflinge'] }),
        context
      );
      const { id } = created.jsonBody as { id: string };
      const [person] = await getStaffLeitende();
      const photo = new Uint8Array(await jpeg(600, 600));
      await LeitendePhoto(request('PUT', { id }, photo, person.etag), context);
      const [withPhoto] = await getStaffLeitende();
      let followingVersion = '';
      t.mock.method(blobStorage, 'deleteBlob', async (name: string) => {
        blobs.delete(name);
        await getDb()
          .updateTable('content.leitende')
          .set({ name: 'Inzwischen geändert' })
          .where('id', '=', Number(id))
          .execute();
        const [following] = await getStaffLeitende();
        followingVersion = following.etag;
      });
      const response = await LeitendePhoto(
        request(operation, { id }, operation === 'PUT' ? photo : undefined, withPhoto.etag),
        context
      );
      assert.equal(response.status, 200);
      const ownVersion = (response.jsonBody as { etag?: string }).etag;
      assert.equal(typeof ownVersion, 'string');
      assert.notEqual(followingVersion, '');
      assert.notEqual(
        ownVersion,
        followingVersion,
        'cleanup must not replace the version of the photo write with a later editor version'
      );
      const stale = await LeitendeItem(
        request('PATCH', { id }, { name: 'Alter Entwurf', teams: ['Wölflinge'], etag: ownVersion }),
        context
      );
      assert.equal(stale.status, 409, 'the old form must not overwrite the concurrent change');
    }
  );
}
