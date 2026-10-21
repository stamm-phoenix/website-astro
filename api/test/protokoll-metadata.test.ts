import * as database from '../lib/db';
import { activateProtokolle } from '../lib/protokoll-cutover';
import { ValidationError } from '../lib/pflege-validation';
import assert from 'node:assert/strict';
import { dbTest } from './fixtures/database';
import { getDb, VersionConflictError } from '../lib/db';
import * as graph from '../lib/sharepoint-data-access';
import {
  importProtokollMetadata,
  verifyProtokollImport,
  verifyProtokollDeploymentImport,
} from '../lib/protokoll-import';
import {
  withProtokollMetadata,
  withProtokollMetadataList,
  updateProtokollMetadata,
  completeProtokollDelivery,
  assertProtokollImport,
  createProtokollMetadata,
} from '../lib/protokoll-metadata';
import { driveItem } from './fixtures/protokolle';
import { overrideConfig } from './fixtures/config';
import { CONFIG } from '../lib/config';

dbTest(
  'SQL import preserves raw workflow JSON; retries never overwrite newer decisions',
  async (t) => {
    overrideConfig(t, CONFIG.protokolle, { folderPath: 'Protokolle/Leitendenrunde' });
    const drive = 'import-preserve';
    const item = driveItem({
      Status: 'Verschickt',
      Versand: '{"state":"attempted","recipients":3}',
      Termin: '{"legacy":"exact value"}',
    });
    await assert.rejects(
      assertProtokollImport(drive),
      (error: unknown) => error instanceof ValidationError && /migriert/.test(error.fields.form)
    );
    assert.equal(await importProtokollMetadata(drive, [item]), 1);
    await verifyProtokollImport(drive, [item]);
    await activateProtokolle(async () => verifyProtokollImport(drive, [item]));
    const stored = await withProtokollMetadata(drive, item);
    assert.equal(stored.metadata?.fields.Termin, item.listItem.fields?.Termin);
    assert.equal(stored.listItem, undefined);
    t.mock.method(graph, 'getSharePointDriveItem', async () => item);
    await updateProtokollMetadata(
      drive,
      item.id,
      { Termin: 'manual change' },
      stored.metadata!.etag
    );
    await assert.rejects(importProtokollMetadata(drive, [item]), /INITIAL_FREEZE/);
    assert.equal(
      (await withProtokollMetadata(drive, item)).metadata?.fields.Termin,
      'manual change'
    );
    await verifyProtokollImport(drive, [item]);
    await assert.rejects(
      verifyProtokollImport(drive, [
        { ...item, listItem: { fields: { Termin: 'changed in SharePoint' } } },
      ]),
      /changed/
    );
  }
);
dbTest(
  'SQL reservation has one winner and external file edits invalidate the combined ETag',
  async (t) => {
    overrideConfig(t, CONFIG.protokolle, { folderPath: 'Protokolle/Leitendenrunde' });
    const drive = 'race-reservation';
    const item = driveItem({ Status: 'Freigegeben' });
    await importProtokollMetadata(drive, [item]);
    await activateProtokolle(async () => verifyProtokollImport(drive, [item]));
    t.mock.method(graph, 'getSharePointDriveItem', async () => item);
    const loaded = await withProtokollMetadata(drive, item);
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        updateProtokollMetadata(
          drive,
          item.id,
          { Versand: '{"state":"attempted"}' },
          loaded.metadata!.etag
        )
      )
    );
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      results.filter(
        (result) => result.status === 'rejected' && result.reason instanceof VersionConflictError
      ).length,
      1
    );
    const current = await withProtokollMetadata(drive, item);
    item.cTag = 'external edit';
    await assert.rejects(
      updateProtokollMetadata(drive, item.id, { Status: 'Verschickt' }, current.metadata!.etag),
      VersionConflictError
    );
    const edited = await withProtokollMetadata(drive, item);
    await updateProtokollMetadata(drive, item.id, { Termin: '2026-10-20' }, edited.metadata!.etag);
    t.mock.method(graph, 'getSharePointDriveItem', async () => {
      throw new Error('No Graph read after delivery');
    });
    await assert.rejects(
      completeProtokollDelivery(drive, item.id, 'another attempt'),
      VersionConflictError
    );
    await completeProtokollDelivery(drive, item.id, '{"state":"attempted"}', '{"state":"sent"}');
    const completed = await withProtokollMetadata(drive, item);
    assert.equal(completed.metadata!.fields.Termin, '2026-10-20');
    assert.equal(completed.metadata!.fields.Status, 'Verschickt');
    await assert.rejects(
      completeProtokollDelivery(drive, item.id, '{"state":"attempted"}'),
      VersionConflictError
    );
  }
);
dbTest('invalid legacy column rolls back all rows and the completion marker', async (t) => {
  overrideConfig(t, CONFIG.protokolle, { folderPath: 'Protokolle/Leitendenrunde' });
  const drive = 'rollback-import';
  const bad = driveItem({});
  Object.assign(bad.listItem.fields!, { Termin: 123 });
  await assert.rejects(
    importProtokollMetadata(drive, [driveItem({}, { id: 'first' }), bad]),
    /column type/
  );
  assert.equal(
    (
      await getDb()
        .selectFrom('organisation.protokoll')
        .selectAll()
        .where('drive_id', '=', drive)
        .execute()
    ).length,
    0
  );
  await assert.rejects(
    assertProtokollImport(drive),
    (error: unknown) => error instanceof ValidationError && /migriert/.test(error.fields.form)
  );
});

dbTest(
  'migration upgrades an exact old cTag while retaining its untouched source snapshot',
  async (t) => {
    overrideConfig(t, CONFIG.protokolle, { folderPath: 'Protokolle/Leitendenrunde' });
    const item = driveItem(
      {
        FreigabeVersion: 'legacy-tag',
        Termin: '{"sourceVersion":"legacy-tag","decision":"bestaetigt"}',
      },
      { cTag: 'legacy-tag', contentVersion: 'docx-word-sha256:checked' }
    );
    await importProtokollMetadata('upgrade', [item]);
    const loaded = await withProtokollMetadata('upgrade', item);
    assert.equal(loaded.metadata?.fields.FreigabeVersion, 'docx-word-sha256:checked');
    assert.equal(
      JSON.parse(loaded.metadata!.fields.Termin!).sourceVersion,
      'docx-word-sha256:checked'
    );
    await verifyProtokollImport('upgrade', [item]);
  }
);

dbTest(
  'a listing between file creation and initial workflow save does not lose the draft',
  async (t) => {
    overrideConfig(t, CONFIG.protokolle, { folderPath: 'Protokolle/Leitendenrunde' });
    await importProtokollMetadata('create-race', []);
    await activateProtokolle(async () => {});
    const item = driveItem({}, { id: 'new-file' });
    await withProtokollMetadata('create-race', item);
    await createProtokollMetadata('create-race', item.id, {
      Status: 'Entwurf',
      ErstelltVon: 'author@example.test',
    });
    assert.equal(
      (await withProtokollMetadata('create-race', item)).metadata?.fields.Status,
      'Entwurf'
    );
  }
);

dbTest(
  'the list reads the stored workflow of all files and creates rows only for new ones',
  async (t) => {
    overrideConfig(t, CONFIG.protokolle, { folderPath: 'Protokolle/Leitendenrunde' });
    const reviewed = driveItem({ Status: 'Review' }, { id: 'reviewed' });
    const approved = driveItem({ Status: 'Freigegeben' }, { id: 'approved' });
    const added = driveItem({}, { id: 'added' });
    await importProtokollMetadata('list', [reviewed, approved]);
    // The same file id in another library must not be mixed up
    await importProtokollMetadata('list-other', [
      driveItem({ Status: 'Verschickt' }, { id: 'approved' }),
    ]);
    await activateProtokolle(async () => verifyProtokollImport('list', [reviewed, approved]));

    const listed = await withProtokollMetadataList('list', [approved, added, reviewed]);

    assert.deepEqual(
      listed.map((item) => [item.id, item.metadata?.fields.Status, item.listItem]),
      [
        ['approved', 'Freigegeben', undefined],
        ['added', undefined, undefined],
        ['reviewed', 'Review', undefined],
      ]
    );
    // The same versions as reading each file on its own, so saving from the list still works
    for (const item of [approved, added, reviewed]) {
      assert.equal(
        listed.find((entry) => entry.id === item.id)?.metadata?.etag,
        (await withProtokollMetadata('list', item)).metadata?.etag
      );
    }
    const rows = await getDb()
      .selectFrom('organisation.protokoll')
      .select('item_id')
      .where('drive_id', '=', 'list')
      .orderBy('item_id')
      .execute();
    assert.deepEqual(
      rows.map((row) => row.item_id),
      ['added', 'approved', 'reviewed']
    );
    await assert.rejects(
      withProtokollMetadataList('not-imported', [added]),
      (error: unknown) => error instanceof ValidationError
    );
  }
);

dbTest(
  'deployment source drift warns only after a valid import; activation verification remains strict',
  async (t) => {
    overrideConfig(t, CONFIG.protokolle, { folderPath: 'Protokolle/Leitendenrunde' });
    const item = driveItem({ Status: 'Review' });
    await assert.rejects(verifyProtokollDeploymentImport('deploy-check', [item]), /not complete/);
    await importProtokollMetadata('deploy-check', [item]);
    assert.equal(await verifyProtokollDeploymentImport('deploy-check', [item]), true);
    item.listItem.fields = {};
    assert.equal(await verifyProtokollDeploymentImport('deploy-check', [item]), false);
    await assert.rejects(verifyProtokollImport('deploy-check', [item]), /changed/);
    assert.equal(
      (
        await getDb()
          .selectFrom('organisation.protokoll')
          .select('fields')
          .where('drive_id', '=', 'deploy-check')
          .executeTakeFirstOrThrow()
      ).fields,
      '{"Status":"Review"}'
    );
    Object.assign(item.listItem.fields, { Status: 123 });
    await assert.rejects(verifyProtokollDeploymentImport('deploy-check', [item]), /column type/);
    const unavailable = new Error('SQL access denied');
    t.mock.method(database, 'getDb', () => {
      throw unavailable;
    });
    await assert.rejects(
      verifyProtokollDeploymentImport('deploy-check', [item]),
      (error) => error === unavailable
    );
  }
);
