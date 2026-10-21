import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import {
  docxContentVersion,
  resetProtokollContentVersionCache,
  withProtokollContentVersion,
  withProtokollContentVersions,
} from '../lib/protokoll-content-version';
import * as store from '../lib/protokoll-content-version-store';
import { sql } from 'kysely';
import { getDb } from '../lib/db';
import { seedPreviewProtokolle } from '../lib/db-preview';
import { writeZip } from '../lib/zip';
import { docx, paragraph } from './fixtures/docx';
import { dbTest } from './fixtures/database';
import * as sharePoint from '../lib/sharepoint-data-access';
import type { ProtokollDriveItem } from '../lib/protokolle';

test('Word content fingerprints ignore SharePoint properties but detect text, style and image edits', () => {
  const parts = [
    { name: 'word/document.xml', data: Buffer.from('<document>Meeting</document>') },
    { name: 'word/styles.xml', data: Buffer.from('<style>original</style>') },
    { name: 'word/media/image.png', data: Buffer.from('image') },
  ];
  const version = docxContentVersion(writeZip(parts));
  assert.equal(
    docxContentVersion(
      writeZip([
        ...[...parts].reverse(),
        { name: 'customXml/item3.xml', data: Buffer.from('SharePoint Termin JSON') },
        { name: '[trash]/0003.dat', data: Buffer.from('old metadata') },
        { name: 'docProps/core.xml', data: Buffer.from('modified timestamp') },
      ])
    ),
    version
  );
  for (let index = 0; index < parts.length; index++) {
    const changed = parts.map((part, i) =>
      i === index ? { ...part, data: Buffer.from('edited') } : part
    );
    assert.notEqual(docxContentVersion(writeZip(changed)), version);
  }
  assert.throws(() => docxContentVersion(writeZip([])), /Not a Word file/);
});

test('a file changing while its fingerprint is downloaded cannot validate a stored version', async (t) => {
  const file = docx(paragraph('Original meeting'));
  const item: ProtokollDriveItem = {
    id: 'version-race',
    name: 'meeting.docx',
    cTag: 'before',
    listItem: { eTag: 'before', fields: { FreigabeVersion: docxContentVersion(file) } },
  };
  t.mock.method(sharePoint, 'getSharePointDriveFileContent', async () => file);
  t.mock.method(sharePoint, 'getSharePointDriveItem', async () => ({
    ...item,
    cTag: 'after',
  }));
  assert.equal((await withProtokollContentVersion('drive', item)).contentVersion, '');
});

test('large folders retain current fingerprints and limit concurrent downloads', async (t) => {
  t.mock.method(store, 'readProtokollContentVersions', async () => new Map());
  t.mock.method(store, 'saveProtokollContentVersions', async () => undefined);
  const file = docx(paragraph('Meeting'));
  const items: ProtokollDriveItem[] = Array.from({ length: 70 }, (_, index) => ({
    id: `cache-${index}`,
    name: 'meeting.docx',
    cTag: 'first',
    listItem: { eTag: 'first', fields: { FreigabeVersion: docxContentVersion(file) } },
  }));
  let downloads = 0;
  let active = 0;
  let peak = 0;
  t.mock.method(sharePoint, 'getSharePointDriveFileContent', async () => {
    downloads++;
    peak = Math.max(peak, ++active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    active--;
    return file;
  });
  t.mock.method(sharePoint, 'getSharePointDriveItem', async (_drive: string, id: string) =>
    items.find((item) => item.id === id)
  );
  await withProtokollContentVersions('cache-drive', items);
  assert.equal(downloads, 70);
  assert.equal(peak, 4);
  await withProtokollContentVersions('cache-drive', items);
  assert.equal(downloads, 70);
  items[0].cTag = 'edited';
  await withProtokollContentVersions('cache-drive', items);
  assert.equal(downloads, 71);
  await withProtokollContentVersions('cache-drive', []);
  await withProtokollContentVersions('cache-drive', items.slice(0, 1));
  assert.equal(downloads, 72);
});

function approved(id: string, file: Uint8Array, cTag = 'first'): ProtokollDriveItem {
  return {
    id,
    name: 'meeting.docx',
    cTag,
    listItem: { eTag: cTag, fields: { FreigabeVersion: docxContentVersion(file) } },
  };
}

/** Graph serves `items` as they are now; returns the mocked download. */
function mockGraph(t: TestContext, items: ProtokollDriveItem[], file: Uint8Array) {
  t.mock.method(sharePoint, 'getSharePointDriveItem', async (_drive: string, id: string) =>
    structuredClone(items.find((item) => item.id === id))
  );
  return t.mock.method(sharePoint, 'getSharePointDriveFileContent', async () => file);
}

async function storedRows(driveId: string) {
  return getDb()
    .selectFrom('organisation.protokoll_content_version')
    .select(['item_id', 'ctag', 'content_version'])
    .where('drive_id', '=', driveId)
    .orderBy('item_id')
    .execute();
}

dbTest('a new process reuses the stored version instead of downloading the file', async (t) => {
  resetProtokollContentVersionCache();
  const file = docx(paragraph('Stored meeting'));
  const draft: ProtokollDriveItem = {
    id: 'draft',
    name: 'draft.docx',
    cTag: 'draft',
    listItem: { fields: { Status: 'Entwurf' } },
  };
  const items = [approved('stored', file), draft];
  const download = mockGraph(t, items, file);
  const first = await withProtokollContentVersions('drive-restart', items);
  assert.equal(download.mock.callCount(), 1);
  assert.equal(first[0].contentVersion, docxContentVersion(file));
  assert.deepEqual(await storedRows('drive-restart'), [
    { item_id: 'stored', ctag: 'first', content_version: docxContentVersion(file) },
  ]);

  resetProtokollContentVersionCache();
  const save = t.mock.method(store, 'saveProtokollContentVersions');
  const restarted = await withProtokollContentVersions('drive-restart', items);
  assert.equal(download.mock.callCount(), 1);
  assert.deepEqual(restarted, first);
  // A current row is not written again
  assert.equal(save.mock.callCount(), 0);
});

dbTest('a changed cTag downloads the file again and replaces the stored version', async (t) => {
  resetProtokollContentVersionCache();
  let file = docx(paragraph('Original meeting'));
  const items = [approved('edited', file)];
  const download = mockGraph(t, items, file);
  await withProtokollContentVersions('drive-edit', items);
  assert.equal(download.mock.callCount(), 1);

  resetProtokollContentVersionCache();
  file = docx(paragraph('Edited meeting'));
  download.mock.mockImplementation(async () => file);
  items[0].cTag = 'second';
  const [changed] = await withProtokollContentVersions('drive-edit', items);
  assert.equal(download.mock.callCount(), 2);
  assert.equal(changed.contentVersion, docxContentVersion(file));
  assert.deepEqual(await storedRows('drive-edit'), [
    { item_id: 'edited', ctag: 'second', content_version: docxContentVersion(file) },
  ]);
});

dbTest('a file changing during the download stores nothing', async (t) => {
  resetProtokollContentVersionCache();
  const file = docx(paragraph('Meeting'));
  const item = approved('racing', file);
  mockGraph(t, [{ ...item, cTag: 'after' }], file);
  const [result] = await withProtokollContentVersions('drive-race', [item]);
  assert.equal(result.contentVersion, '');
  assert.deepEqual(await storedRows('drive-race'), []);
});

dbTest('files no longer in the folder lose their stored version', async (t) => {
  resetProtokollContentVersionCache();
  const file = docx(paragraph('Meeting'));
  const items = [approved('kept', file), approved('removed', file)];
  mockGraph(t, items, file);
  await withProtokollContentVersions('drive-prune', items);
  await withProtokollContentVersions('drive-other', items);
  await withProtokollContentVersions('drive-prune', items.slice(0, 1));
  assert.deepEqual(
    (await storedRows('drive-prune')).map((row) => row.item_id),
    ['kept']
  );
  assert.equal((await storedRows('drive-other')).length, 2);
});

dbTest('concurrent lists store each version once without failing', async (t) => {
  resetProtokollContentVersionCache();
  const file = docx(paragraph('Meeting'));
  const version = docxContentVersion(file);
  const items = Array.from({ length: 20 }, (_, index) => approved(`parallel-${index}`, file));
  mockGraph(t, items, file);
  const warn = t.mock.method(console, 'warn', () => undefined);
  // All lists find nothing stored and write the same rows at once
  await Promise.all(
    Array.from({ length: 3 }, () => withProtokollContentVersions('drive-parallel', items))
  );
  assert.equal(warn.mock.callCount(), 0);
  assert.equal((await storedRows('drive-parallel')).length, 20);
  // Inserts and updates of the same rows race; the last one wins without an error
  await Promise.all(
    Array.from({ length: 5 }, (_, run) =>
      store.saveProtokollContentVersions(
        'drive-racing-saves',
        new Map(items.map((item) => [item.id, { cTag: `run-${run}`, version }])),
        []
      )
    )
  );
  const rows = await storedRows('drive-racing-saves');
  assert.equal(rows.length, 20);
  assert.equal(new Set(rows.map((row) => row.ctag)).size, 1);
});

dbTest('a save waits for a concurrent insert of the same row instead of failing', async () => {
  let saved: Promise<void> | undefined;
  await getDb()
    .transaction()
    .execute(async (trx) => {
      // Like a MERGE of another list: it found no row and holds the key range
      await sql`
        SELECT item_id FROM organisation.protokoll_content_version WITH (UPDLOCK, HOLDLOCK)
        WHERE drive_id = N'drive-wait' AND item_id = N'row'
      `.execute(trx);
      saved = store.saveProtokollContentVersions(
        'drive-wait',
        new Map([['row', { cTag: 'mine', version: 'v2' }]]),
        []
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      await trx
        .insertInto('organisation.protokoll_content_version')
        .values({ drive_id: 'drive-wait', item_id: 'row', ctag: 'other', content_version: 'v1' })
        .execute();
    });
  await saved;
  assert.deepEqual(await storedRows('drive-wait'), [
    { item_id: 'row', ctag: 'mine', content_version: 'v2' },
  ]);
});

dbTest('preview test data has a stored version and is seeded once', async () => {
  await seedPreviewProtokolle();
  await seedPreviewProtokolle();
  assert.equal((await storedRows('preview-documents')).length, 1);
});

test('a failing database never fails the list and the files are still checked', async (t) => {
  resetProtokollContentVersionCache();
  const file = docx(paragraph('Meeting'));
  const items = [approved('offline', file)];
  const download = mockGraph(t, items, file);
  const warn = t.mock.method(console, 'warn', () => undefined);
  t.mock.method(store, 'readProtokollContentVersions', async () => new Map());
  t.mock.method(store, 'saveProtokollContentVersions', async () => {
    throw new Error('database down');
  });
  const [saved] = await withProtokollContentVersions('drive-offline', items);
  assert.equal(saved.contentVersion, docxContentVersion(file));

  resetProtokollContentVersionCache();
  t.mock.method(store, 'readProtokollContentVersions', async () => {
    throw new Error('database down');
  });
  const [read] = await withProtokollContentVersions('drive-offline', items);
  assert.equal(read.contentVersion, docxContentVersion(file));
  assert.equal(download.mock.callCount(), 2);
  assert.equal(warn.mock.callCount(), 2);
});
