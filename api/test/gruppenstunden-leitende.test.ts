import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { TestContext } from 'node:test';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { sql } from 'kysely';
import sharp from 'sharp';
import * as blobStorage from '../lib/blob-storage';
import { CONFIG } from '../lib/config';
import { createDatabase, getDb, inTransaction, useDatabase } from '../lib/db';
import { seedPreviewGruppenstunden, seedPreviewLeitende } from '../lib/db-preview';
import { getGruppenstunden, getStaffGruppenstunden } from '../lib/gruppenstunden-list';
import {
  ORPHAN_MIN_AGE_MS,
  getLeitende,
  getStaffLeitende,
  updateLeitende,
} from '../lib/leitende-list';
import { importSharePointList } from '../lib/sharepoint-import';
import * as sharePointData from '../lib/sharepoint-data-access';
import * as sharePointRest from '../lib/sharepoint-rest';
import { SharePointRestError } from '../lib/sharepoint-rest';
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
import { overrideConfig } from './fixtures/config';
import { dbTest, target } from './fixtures/database';

const PRINCIPAL = {
  identityProvider: 'aad',
  userId: 'test-staff',
  userDetails: 'staff@example.test',
  userRoles: ['authenticated'],
};

const GRUPPENSTUNDEN_LIST = 'list-gruppenstunden';
const LEITENDE_LIST = 'list-leitende';

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

/** SharePoint lists with the given items; attachments by `<item>/<file>`. */
function mockSharePoint(
  t: TestContext,
  lists: {
    gruppenstunden?: unknown[];
    leitende?: unknown[];
    teams?: string[];
    attachments?: Record<string, Uint8Array | Error>;
  }
): void {
  overrideConfig(t, CONFIG.sharepoint.lists, {
    gruppenstunden: GRUPPENSTUNDEN_LIST,
    leitende: LEITENDE_LIST,
  });
  t.mock.method(sharePointData, 'getSharePointListItems', async (listId: string) => {
    if (listId === GRUPPENSTUNDEN_LIST) return structuredClone(lists.gruppenstunden ?? []);
    if (listId === LEITENDE_LIST) return structuredClone(lists.leitende ?? []);
    throw new Error(`Unexpected list ${listId}`);
  });
  t.mock.method(sharePointData, 'getSharePointChoiceValues', async () => lists.teams ?? []);
  t.mock.method(
    sharePointRest,
    'getListItemAttachment',
    async (_listId: string, itemId: string, fileName: string) => {
      const value = lists.attachments?.[`${itemId}/${fileName}`];
      if (value instanceof Error) throw value;
      if (!value) throw new SharePointRestError(404, 'Not found');
      return value;
    }
  );
}

function image(fileName: string): string {
  return JSON.stringify({ type: 'thumbnail', fileName, fieldName: 'Image0' });
}

dbTest('the Gruppenstunden are taken over once with their IDs', async (t) => {
  setup(t);
  mockSharePoint(t, {
    gruppenstunden: [
      {
        id: '3',
        fields: {
          Title: 'Wölflinge',
          Wochentag: 'Montags',
          Zeit: '17:00 Uhr',
          Alter: '7 – 10 Jahre',
          Ort: 'Pfarrheim',
          Beschreibung:
            '<div class="ExternalClass12"><p>Spiel &amp; Spaß</p><script>x</script></div>',
        },
      },
      { id: '7', fields: { Title: 'Rover', Wochentag: 'Freitags', Zeit: '19 Uhr', Ort: 'Heim' } },
    ],
  });

  const [first, second] = await Promise.all([
    importSharePointList('gruppenstunden'),
    importSharePointList('gruppenstunden'),
  ]);
  assert.deepEqual([first, second].filter(Boolean), [{ items: 2 }]);
  assert.equal(await importSharePointList('gruppenstunden'), undefined);

  assert.deepEqual(await getGruppenstunden(), [
    {
      id: '3',
      stufe: 'Wölflinge',
      weekday: 'Montags',
      time: '17:00 Uhr',
      ageRange: '7 – 10 Jahre',
      location: 'Pfarrheim',
      description: '<div><p>Spiel &amp; Spaß</p></div>',
    },
    {
      id: '7',
      stufe: 'Rover',
      weekday: 'Freitags',
      time: '19 Uhr',
      ageRange: '',
      location: 'Heim',
      description: '',
    },
  ]);

  // New entries continue after the highest taken-over ID
  const { context } = setup(t);
  const created = await GruppenstundenCollection(
    request(
      'POST',
      {},
      {
        stufe: 'Pfadfinder',
        weekday: 'Mittwochs',
        time: '18 Uhr',
        ageRange: '',
        location: 'Heim',
        description: '',
      }
    ),
    context
  );
  assert.equal(created.status, 201);
  assert.ok(Number((created.jsonBody as { id: string }).id) > 7);
});

dbTest('the Leitende are taken over with teams, addresses and photos', async (t) => {
  const { context, blobs } = setup(t);
  mockSharePoint(t, {
    teams: ['Vorstand', 'Wölflinge', 'Küche'],
    leitende: [
      {
        id: '2',
        fields: {
          Title: 'Vera Vorstand',
          Team: ['Vorstand', 'Wölflinge'],
          Telefon: '0123 456',
          Street: 'Hauptstraße 1',
          PostalCode: '12345',
          City: 'Musterstadt',
          Image0: image('Reserved_ImageAttachment_vera.png'),
        },
      },
      {
        id: '5',
        fields: {
          Title: 'Volker Vorstand',
          Team: 'Vorstand',
          Adresse: JSON.stringify({
            Address: { Street: 'Nebenweg 2', PostalCode: '54321', City: 'Beispielstadt' },
          }),
          Image0: image('verloren.jpg'),
        },
      },
      {
        id: '9',
        fields: { Title: 'Lea Leiterin', Team: ['Lagerteam'], Image0: image('kaputt.jpg') },
      },
    ],
    attachments: {
      '2/Reserved_ImageAttachment_vera.png': await sharp({
        create: { width: 900, height: 600, channels: 3, background: '#810a1a' },
      })
        .png()
        .toBuffer(),
      '9/kaputt.jpg': new Uint8Array([1, 2, 3]),
    },
  });

  const summary = await importSharePointList('leitende');
  assert.deepEqual(summary, {
    items: 3,
    photos: 1,
    missingPhotos: ['5', '9'],
    addedTeams: ['Küche', 'Lagerteam'],
  });

  const leitende = await getLeitende();
  const file = leitende[0].imageFileName ?? '';
  assert.match(file, /^foto-\d+\.jpg$/);
  assert.deepEqual([...blobs.keys()], [`leitende/2/${file}`]);
  assert.deepEqual(leitende, [
    {
      id: '2',
      name: 'Vera Vorstand',
      teams: ['Vorstand', 'Wölflinge'],
      telephone: '0123 456',
      street: 'Hauptstraße 1',
      city: '12345 Musterstadt',
      imageFileName: file,
      hasImage: true,
    },
    {
      id: '5',
      name: 'Volker Vorstand',
      teams: ['Vorstand'],
      telephone: undefined,
      street: 'Nebenweg 2',
      city: '54321 Beispielstadt',
      imageFileName: undefined,
      hasImage: false,
    },
    {
      id: '9',
      name: 'Lea Leiterin',
      teams: ['Lagerteam'],
      telephone: undefined,
      street: undefined,
      city: undefined,
      imageFileName: undefined,
      hasImage: false,
    },
  ]);

  // The photo is stored as a small JPEG and served under the old address
  const photo = await sharp(blobs.get(`leitende/2/${file}`)).metadata();
  assert.deepEqual([photo.format, photo.width, photo.height], ['jpeg', 300, 200]);
  const served = await GetLeitendeImage(request('GET', { id: '2' }), context);
  assert.equal(served.status, 200);
  assert.equal((await GetLeitendeImage(request('GET', { id: '5' }), context)).status, 404);

  const vorstand = await GetVorstandEndpoint();
  assert.deepEqual(
    (vorstand.jsonBody as { name: string }[]).map((person) => person.name),
    ['Vera Vorstand', 'Volker Vorstand']
  );
  const gruppenstunden = await GetGruppenstundenEndpoint();
  assert.equal(gruppenstunden.status, 200);

  const teams = await LeitendeCollection(request('GET'), context);
  assert.deepEqual((teams.jsonBody as { teams: string[] }).teams, [
    'Vorstand',
    'Wölflinge',
    'Jungpfadfinder',
    'Pfadfinder',
    'Rover',
    'Küche',
    'Lagerteam',
  ]);
});

dbTest('a failed photo download stops the import without writing anything', async (t) => {
  setup(t);
  mockSharePoint(t, {
    leitende: [{ id: '1', fields: { Title: 'Vera', Team: 'Vorstand', Image0: image('a.jpg') } }],
    attachments: { '1/a.jpg': new SharePointRestError(503, 'Service unavailable') },
  });
  await assert.rejects(importSharePointList('leitende'));
  assert.deepEqual(await getStaffLeitende(), []);
  const marks = await getDb().selectFrom('content.sharepoint_import').selectAll().execute();
  assert.deepEqual(marks, []);
});

dbTest('tests and scripts with their own database never read SharePoint', async (t) => {
  setup(t);
  const read = t.mock.method(sharePointData, 'getSharePointListItems', async () => {
    throw new Error('SharePoint must not be read');
  });
  assert.deepEqual(await getStaffGruppenstunden(), []);
  assert.deepEqual(await getStaffLeitende(), []);
  assert.equal(read.mock.callCount(), 0);
});

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
  assert.equal(removed.status, 204);
  assert.equal(blobs.size, 0);
  const [withoutPhoto] = await getStaffLeitende();
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
  const marks = await getDb()
    .selectFrom('content.sharepoint_import')
    .select(['list', 'summary'])
    .orderBy('list')
    .execute();
  assert.deepEqual(marks, [
    { list: 'gruppenstunden', summary: '{"preview":true}' },
    { list: 'leitende', summary: '{"preview":true}' },
  ]);
});

dbTest('the import and new entries work with the rights of the website', async (t) => {
  setup(t);
  mockSharePoint(t, {
    gruppenstunden: [{ id: '4', fields: { Title: 'Rover', Wochentag: 'Freitags' } }],
    leitende: [
      {
        id: '12',
        fields: { Title: 'Vera', Team: ['Vorstand', 'Küche'], Image0: image('vera.jpg') },
      },
    ],
    teams: ['Küche'],
    attachments: { '12/vera.jpg': new Uint8Array(await jpeg(600, 600)) },
  });

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
    assert.deepEqual(await importSharePointList('gruppenstunden'), { items: 1 });
    assert.equal((await importSharePointList('leitende'))?.items, 1);
    const { context } = setup(t);
    const created = await LeitendeCollection(
      request('POST', {}, { name: 'Neu', teams: ['Küche'] }),
      context
    );
    assert.deepEqual(created.jsonBody, { id: '13' });
    const gruppenstunde = await GruppenstundenCollection(
      request('POST', {}, { ...GRUPPENSTUNDE, stufe: 'Pfadfinder' }),
      context
    );
    assert.deepEqual(gruppenstunde.jsonBody, { id: '5' });
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

dbTest('a takeover that loses to another one leaves no photo files behind', async (t) => {
  const { context, blobs } = setup(t);
  let release = (): void => undefined;
  const slow = new Promise<void>((resolve) => (release = resolve));
  let reads = 0;
  const bytes = new Uint8Array(await jpeg(600, 600));
  mockSharePoint(t, {
    leitende: [{ id: '3', fields: { Title: 'Vera', Team: 'Vorstand', Image0: image('v.jpg') } }],
  });
  (sharePointRest.getListItemAttachment as unknown as { mock: { restore(): void } }).mock.restore();
  t.mock.method(sharePointRest, 'getListItemAttachment', async () => {
    // The second run reads the photo only after the first has finished
    if (++reads === 2) await slow;
    return bytes;
  });

  const runs = [importSharePointList('leitende'), importSharePointList('leitende')];
  const winner = await Promise.race(runs);
  assert.equal(winner?.photos, 1);
  // Meanwhile the photo is removed in the Leitendenbereich
  const [person] = await getStaffLeitende();
  const removed = await LeitendePhoto(
    request('DELETE', { id: '3' }, undefined, person.etag),
    context
  );
  assert.equal(removed.status, 204);
  release();
  const results = await Promise.all(runs);
  assert.equal(results.filter((result) => result === undefined).length, 1);
  assert.deepEqual([...blobs.keys()], []);
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
