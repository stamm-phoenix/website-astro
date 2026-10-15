import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { TestContext } from 'node:test';
import { InvocationContext } from '@azure/functions';
import { sql } from 'kysely';
import sharp from 'sharp';
import * as blobStorage from '../lib/blob-storage';
import { getBelege } from '../lib/beleg-list';
import { getAktionStufen, getStaffAktionen } from '../lib/aktionen-list';
import { CONFIG } from '../lib/config';
import { createDatabase, getDb, useDatabase } from '../lib/db';
import { getInstagramToken } from '../lib/instagram-token';
import { validateAktion } from '../lib/pflege-validation';
import { createAktion } from '../lib/aktionen-list';
import { seedPreviewAktionen, seedPreviewBelege } from '../lib/db-preview';
import { importSharePointList } from '../lib/sharepoint-import';
import * as sharePointData from '../lib/sharepoint-data-access';
import * as sharePointRest from '../lib/sharepoint-rest';
import { SharePointRestError } from '../lib/sharepoint-rest';
import { overrideConfig } from './fixtures/config';
import { dbTest, target } from './fixtures/database';

const CALENDAR = 'list-calendar';
const BELEGE = 'list-belege';
const TOKEN = 'list-token';

/** Blob Storage in memory; logs are kept quiet. */
function setup(t: TestContext): Map<string, Buffer> {
  const blobs = new Map<string, Buffer>();
  t.mock.method(blobStorage, 'putBlob', async (name: string, bytes: Uint8Array) => {
    blobs.set(name, Buffer.from(bytes));
  });
  t.mock.method(blobStorage, 'getBlob', async (name: string) => blobs.get(name));
  t.mock.method(blobStorage, 'deleteBlob', async (name: string) => {
    blobs.delete(name);
  });
  t.mock.method(blobStorage, 'listBlobs', async (prefix: string) =>
    [...blobs.keys()]
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({ name, lastModified: new Date() }))
  );
  t.mock.method(console, 'info', () => undefined);
  t.mock.method(console, 'warn', () => undefined);
  return blobs;
}

/** SharePoint lists with the given items; attachments by `<item>/<file>`. */
function mockSharePoint(
  t: TestContext,
  lists: {
    calendar?: unknown[];
    stufen?: string[];
    belege?: unknown[];
    token?: unknown[];
    attachments?: Record<string, Uint8Array | Error>;
  }
): void {
  overrideConfig(t, CONFIG.sharepoint.lists, {
    calendar: CALENDAR,
    belege: BELEGE,
    instagramToken: TOKEN,
  });
  t.mock.method(sharePointData, 'getSharePointListItems', async (listId: string) => {
    if (listId === CALENDAR) return structuredClone(lists.calendar ?? []);
    if (listId === BELEGE) return structuredClone(lists.belege ?? []);
    if (listId === TOKEN) return structuredClone(lists.token ?? []);
    throw new Error(`Unexpected list ${listId}`);
  });
  t.mock.method(sharePointData, 'getSharePointChoiceValues', async () => lists.stufen ?? []);
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

function image(fileName: string, fieldName = 'Beleg'): string {
  return JSON.stringify({ type: 'thumbnail', fileName, fieldName });
}

async function picture(format: 'jpeg' | 'png'): Promise<Uint8Array> {
  const base = sharp({ create: { width: 900, height: 1200, channels: 3, background: '#eee' } });
  return new Uint8Array(await (format === 'jpeg' ? base.jpeg() : base.png()).toBuffer());
}

const CALENDAR_ITEMS = [
  {
    id: '4',
    fields: {
      Title: 'Sommerlager',
      Stufen: ['Rover', 'Pfadfinder'],
      Start: '2026-08-01T12:00:00Z',
      End: '2026-08-10T12:00:00Z',
      CampFlowId: 'evt_Sola26',
      CampFlow_x002d_Anmeldung: { Url: 'https://campflow.de/sola', Description: 'Anmeldung' },
      Beschreibung: '<div class="ExternalClass1"><p>Zelten</p><script>x</script></div>',
    },
  },
  // A second entry for the same event keeps its data without the link
  { id: '9', fields: { Title: 'Kopie', Stufen: 'Rover', CampFlowId: 'evt_Sola26' } },
  {
    id: '2',
    fields: { Title: 'Stammesfest', Stufen: ['Stamm'], Start: '2026-06-01T12:00:00Z' },
  },
  // An ID that differs only in case is another event and keeps its link
  { id: '5', fields: { Title: 'Andere Aktion', Stufen: ['Rover'], CampFlowId: 'evt_sola26' } },
  { id: '3', fields: { Title: 'Ohne Datum', CampFlowId: 'kein-campflow' } },
];

dbTest('the calendar is taken over with Stufen, dates and CampFlow links', async (t) => {
  setup(t);
  mockSharePoint(t, { calendar: CALENDAR_ITEMS, stufen: ['Wölflinge', 'Rover', 'Stamm'] });

  assert.deepEqual(await importSharePointList('aktionen'), {
    items: 5,
    addedStufen: ['Stamm'],
    unlinked: ['9'],
  });
  assert.equal(await importSharePointList('aktionen'), undefined);

  const entries = (await getStaffAktionen()).map((entry) => {
    const { etag, ...rest } = entry;
    assert.match(etag, /^"[0-9a-f]{16}"$/);
    return rest;
  });
  assert.deepEqual(entries, [
    {
      id: '2',
      campflowId: null,
      title: 'Stammesfest',
      stufen: ['Stamm'],
      start: '2026-06-01',
      end: '2026-06-01',
      link: '',
      description: '',
    },
    {
      id: '3',
      campflowId: null,
      title: 'Ohne Datum',
      stufen: [],
      start: '',
      end: '',
      link: '',
      description: '',
    },
    {
      id: '4',
      campflowId: 'evt_Sola26',
      title: 'Sommerlager',
      stufen: ['Pfadfinder', 'Rover'],
      start: '2026-08-01',
      end: '2026-08-10',
      link: 'https://campflow.de/sola',
      description: '<div><p>Zelten</p></div>',
    },
    {
      id: '5',
      campflowId: 'evt_sola26',
      title: 'Andere Aktion',
      stufen: ['Rover'],
      start: '',
      end: '',
      link: '',
      description: '',
    },
    {
      id: '9',
      campflowId: null,
      title: 'Kopie',
      stufen: ['Rover'],
      start: '',
      end: '',
      link: '',
      description: '',
    },
  ]);
  assert.deepEqual(await getAktionStufen(), [
    'Wölflinge',
    'Jungpfadfinder',
    'Pfadfinder',
    'Rover',
    'Leitende',
    'Stamm',
  ]);

  // New entries continue after the highest taken-over ID
  const id = await createAktion(
    validateAktion({ title: 'Neu', stufen: ['Stamm'], start: '2026-09-01' }, ['Stamm']),
    'staff@example.test'
  );
  assert.equal(id, '10');
});

const BELEG_FIELDS = {
  Title: 'REWE',
  Belegdatum: '2026-09-30',
  BetragCent: 1234,
  BezahltVon: 'Alex',
  Auszahlung: true,
  Aktion: 'Sola',
  EingereichtVon: 'leitung@example.test',
};

dbTest('the receipts are taken over with their photos and originals', async (t) => {
  const blobs = setup(t);
  const jpeg = await picture('jpeg');
  const png = await picture('png');
  mockSharePoint(t, {
    belege: [
      {
        id: '5',
        createdDateTime: '2026-09-30T10:00:00Z',
        fields: {
          ...BELEG_FIELDS,
          Status: 'Abgelehnt',
          Pruefnotiz: 'Unscharf',
          Beleg: image('beleg-1-scan.jpg'),
          KiPruefung: '{"ok":true,"issues":[]}',
        },
      },
      // The original of this scan is gone: the scan stays as plain photo
      {
        id: '6',
        createdDateTime: '2026-09-29T10:00:00Z',
        fields: { ...BELEG_FIELDS, Beleg: image('beleg-2-scan.jpg'), KiPruefung: 'kaputt' },
      },
      {
        id: '7',
        createdDateTime: '2026-09-28T10:00:00Z',
        fields: { ...BELEG_FIELDS, Status: 'Bezahlt', Beleg: image('foto.png') },
      },
      { id: '8', fields: { ...BELEG_FIELDS, Beleg: image('weg.jpg') } },
      // A readable scan with an unreadable original stays as plain photo
      {
        id: '12',
        createdDateTime: '2026-09-27T10:00:00Z',
        fields: { ...BELEG_FIELDS, Beleg: image('beleg-3-scan.jpg') },
      },
      { id: '11', fields: { ...BELEG_FIELDS, BetragCent: -5, Beleg: image('kaputt.jpg') } },
    ],
    attachments: {
      '5/beleg-1-scan.jpg': jpeg,
      '5/beleg-1-original.jpg': jpeg,
      '6/beleg-2-scan.jpg': jpeg,
      '7/foto.png': png,
      '11/kaputt.jpg': new Uint8Array([1, 2, 3]),
      '12/beleg-3-scan.jpg': jpeg,
      '12/beleg-3-original.jpg': new Uint8Array([1, 2, 3]),
    },
  });

  assert.deepEqual(await importSharePointList('belege'), {
    items: 6,
    photos: 4,
    missingPhotos: ['8', '11'],
  });
  const belege = await getBelege();
  const byId = new Map(belege.map((beleg) => [beleg.id, beleg]));
  const first = byId.get('5');
  assert.deepEqual(
    [first?.status, first?.reviewNote, first?.submittedAt, first?.hasOriginal, first?.aiCheck?.ok],
    ['Abgelehnt', 'Unscharf', '2026-09-30T10:00:00.000Z', true, true]
  );
  assert.match(first?.photo ?? '', /^beleg-\d+-scan\.jpg$/);
  assert.deepEqual(
    [byId.get('6')?.hasOriginal, byId.get('6')?.aiCheck, byId.get('6')?.hasImage],
    [false, null, true]
  );
  assert.equal(byId.get('7')?.status, 'Eingereicht');
  assert.deepEqual([byId.get('8')?.hasImage, byId.get('11')?.amountCent], [false, 0]);
  assert.deepEqual([byId.get('12')?.hasImage, byId.get('12')?.hasOriginal], [true, false]);
  assert.match(byId.get('12')?.photo ?? '', /^beleg-\d+\.jpg$/);

  // Every stored photo is a JPEG under the receipt's folder; the PNG was converted
  assert.equal(blobs.size, 5);
  const converted = blobs.get(`belege/7/${byId.get('7')?.photo}`);
  assert.equal((await sharp(converted).metadata()).format, 'jpeg');
  const original = (first?.photo ?? '').replace('-scan', '-original');
  assert.ok(blobs.has(`belege/5/${original}`));
});

dbTest('a failed photo download stops the takeover of the receipts', async (t) => {
  const blobs = setup(t);
  const jpeg = await picture('jpeg');
  mockSharePoint(t, {
    belege: [
      { id: '1', fields: { ...BELEG_FIELDS, Beleg: image('a.jpg') } },
      { id: '2', fields: { ...BELEG_FIELDS, Beleg: image('b.jpg') } },
    ],
    attachments: { '1/a.jpg': jpeg, '2/b.jpg': new SharePointRestError(503, 'unavailable') },
  });
  await assert.rejects(importSharePointList('belege'));
  assert.deepEqual(await getBelege(), []);
  assert.equal(blobs.size, 0);
  const marks = await getDb().selectFrom('content.sharepoint_import').selectAll().execute();
  assert.deepEqual(marks, []);
});

dbTest('a storage error without status code stops the takeover of the receipts', async (t) => {
  const blobs = setup(t);
  mockSharePoint(t, {
    belege: [{ id: '1', fields: { ...BELEG_FIELDS, Beleg: image('a.jpg') } }],
    attachments: { '1/a.jpg': await picture('jpeg') },
  });
  (blobStorage.putBlob as unknown as { mock: { restore(): void } }).mock.restore();
  t.mock.method(blobStorage, 'putBlob', async () => {
    throw new Error('socket hang up');
  });
  await assert.rejects(importSharePointList('belege'), /socket hang up/);
  assert.deepEqual(await getBelege(), []);
  assert.equal(blobs.size, 0);
  const marks = await getDb().selectFrom('content.sharepoint_import').selectAll().execute();
  assert.deepEqual(marks, []);
});

dbTest('the Instagram token is taken over and used', async (t) => {
  setup(t);
  // Whole seconds an hour ago: the column keeps no milliseconds, and the token is still fresh
  const refreshedAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 3_600_000).toISOString();
  mockSharePoint(t, {
    token: [
      { id: '1', fields: { Title: 'Instagram', Token: '' } },
      { id: '2', fields: { Title: 'Instagram', Token: ' IGQ-test ', RefreshedAt: refreshedAt } },
    ],
  });
  assert.deepEqual(await importSharePointList('instagram'), { items: 1 });
  const stored = await getDb().selectFrom('content.instagram_token').selectAll().execute();
  assert.deepEqual(
    stored.map((row) => [row.id, row.token, row.refreshed_at?.toISOString().slice(0, 19)]),
    [[1, 'IGQ-test', refreshedAt.slice(0, 19)]]
  );
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('must not refresh a fresh token');
  });
  const context = new InvocationContext({ functionName: 'instagram-test' });
  assert.equal(await getInstagramToken(context), 'IGQ-test');
  assert.equal(fetch.mock.callCount(), 0);
});

dbTest('an empty token list is taken over without a token', async (t) => {
  setup(t);
  mockSharePoint(t, { token: [] });
  assert.deepEqual(await importSharePointList('instagram'), { items: 0 });
  assert.deepEqual(await getDb().selectFrom('content.instagram_token').selectAll().execute(), []);
});

dbTest('the three lists are taken over with the rights of the website', async (t) => {
  setup(t);
  mockSharePoint(t, {
    calendar: CALENDAR_ITEMS,
    stufen: ['Stamm'],
    belege: [{ id: '3', fields: { ...BELEG_FIELDS, Beleg: image('a.jpg') } }],
    token: [{ id: '1', fields: { Token: 'IGQ' } }],
    attachments: { '3/a.jpg': await picture('jpeg') },
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
    assert.equal((await importSharePointList('aktionen'))?.items, 5);
    assert.equal((await importSharePointList('belege'))?.photos, 1);
    assert.equal((await importSharePointList('instagram'))?.items, 1);
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

dbTest('the preview gets invented Aktionen and Belege once', async (t) => {
  const blobs = setup(t);
  for (let run = 0; run < 2; run++) {
    await seedPreviewAktionen();
    await seedPreviewBelege();
  }
  const aktionen = await getStaffAktionen();
  assert.equal(aktionen.length, 3);
  assert.ok(aktionen.some((entry) => entry.stufen.includes('Leitende')));
  const belege = await getBelege();
  assert.deepEqual(belege.map((beleg) => beleg.status).sort(), [
    'Abgelehnt',
    'Angenommen',
    'Eingereicht',
  ]);
  assert.equal(belege.filter((beleg) => beleg.hasOriginal).length, 1);
  // Three photos and the original of the scan
  assert.equal(blobs.size, 4);
  const marks = await getDb()
    .selectFrom('content.sharepoint_import')
    .select(['list', 'summary'])
    .orderBy('list')
    .execute();
  assert.deepEqual(marks, [
    { list: 'aktionen', summary: '{"preview":true}' },
    { list: 'belege', summary: '{"preview":true}' },
  ]);
});
