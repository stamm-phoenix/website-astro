import { completeProtokollDelivery } from '../lib/protokoll-metadata';
import assert from 'node:assert/strict';
import { dbTest } from './fixtures/database';
import { getDb } from '../lib/db';
import {
  activateProtokolle,
  freezeProtokolle,
  withProtokollGate,
  ProtokollMaintenanceError,
} from '../lib/protokoll-cutover';
import { importProtokollMetadata, verifyProtokollImport } from '../lib/protokoll-import';
import { writeProtokollSource } from '../lib/protokoll-restore';
import { driveItem } from './fixtures/protokolle';
import { overrideConfig } from './fixtures/config';
import { CONFIG } from '../lib/config';

dbTest(
  'activation fails closed; freezing waits for in-flight side effects without replay',
  async () => {
    await assert.rejects(
      withProtokollGate(async () => {
        throw new Error('must not execute');
      }),
      ProtokollMaintenanceError
    );
    await assert.rejects(
      activateProtokolle(async () => {
        throw new Error('source changed');
      }),
      /source changed/
    );
    await assert.rejects(
      withProtokollGate(async () => true),
      ProtokollMaintenanceError
    );
    await assert.rejects(
      completeProtokollDelivery('lost-gate', 'item', 'attempt'),
      ProtokollMaintenanceError
    );
    await activateProtokolle(async () => {});
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let calls = 0;
    const request = withProtokollGate(async () => {
      calls++;
      enter();
      await finished;
      return withProtokollGate(async () => 'sent');
    });
    await entered;
    let frozen = false;
    const freeze = freezeProtokolle().then(() => {
      frozen = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(frozen, false);
    finish();
    assert.equal(await request, 'sent');
    await freeze;
    assert.equal(calls, 1);
    await assert.rejects(
      withProtokollGate(async () => true),
      ProtokollMaintenanceError
    );
  }
);

dbTest(
  'reimport replaces changed and cleared snapshots, but refuses overwriting SQL decisions',
  async (t) => {
    overrideConfig(t, CONFIG.protokolle, { folderPath: 'Protokolle/Leitendenrunde' });
    const item = driveItem({ Status: 'Review', Termin: 'old' });
    await importProtokollMetadata('reconcile', [item]);
    item.listItem.fields = { Status: 'Freigegeben' };
    await assert.rejects(verifyProtokollImport('reconcile', [item]), /changed/);
    assert.equal(await importProtokollMetadata('reconcile', [item]), 1);
    await verifyProtokollImport('reconcile', [item]);
    item.listItem.fields = {};
    await assert.rejects(verifyProtokollImport('reconcile', [item]), /changed/);
    assert.equal(await importProtokollMetadata('reconcile', [item]), 1);
    await verifyProtokollImport('reconcile', [item]);
    const saved = await getDb()
      .selectFrom('organisation.protokoll')
      .selectAll()
      .where('drive_id', '=', 'reconcile')
      .executeTakeFirstOrThrow();
    assert.equal(saved.fields, '{}');
    await getDb()
      .updateTable('organisation.protokoll')
      .set({ fields: '{"Status":"Verschickt"}' })
      .where('drive_id', '=', 'reconcile')
      .execute();
    item.listItem.fields = { Status: 'Review' };
    await assert.rejects(importProtokollMetadata('reconcile', [item]), /SQL_CHANGED/);
    await activateProtokolle(async () => {});
    await freezeProtokolle();
    await assert.rejects(importProtokollMetadata('reconcile', [item]), /INITIAL_FREEZE/);
  }
);

dbTest(
  'cleanup and restore are conditional, resumable, retain current SQL and reject foreign edits',
  async (t) => {
    overrideConfig(t, CONFIG.protokolle, { folderPath: 'Protokolle/Leitendenrunde' });
    const item = driveItem({ Status: 'Review' });
    await importProtokollMetadata('restore', [item]);
    await assert.rejects(
      writeProtokollSource('restore', [item], { read: async () => item, write: async () => {} }),
      /SQL_FREEZE/
    );
    await activateProtokolle(async () => verifyProtokollImport('restore', [item]));
    await getDb()
      .updateTable('organisation.protokoll')
      .set({ fields: '{"Status":"Verschickt","Versand":"sent"}' })
      .where('drive_id', '=', 'restore')
      .execute();
    await freezeProtokolle();
    let writes = 0;
    const source = {
      read: async () => structuredClone(item),
      write: async (_id: string, fields: Record<string, string | null>, etag: string) => {
        assert.equal(etag, item.listItem.eTag);
        writes++;
        item.listItem.fields = Object.fromEntries(
          Object.entries(fields).filter(([, value]) => value !== null)
        );
      },
    };
    await writeProtokollSource('restore', [item], source, true);
    await verifyProtokollImport('restore', [item]);
    await writeProtokollSource('restore', [item], source);
    assert.equal(item.listItem.fields!.Status, 'Verschickt');
    assert.equal(item.listItem.fields!.Versand, 'sent');
    await verifyProtokollImport('restore', [item]);
    await writeProtokollSource('restore', [item], source);
    assert.equal(writes, 2);
    item.listItem.fields = { Status: 'foreign edit' };
    await assert.rejects(writeProtokollSource('restore', [item], source), /SOURCE_CHANGED/);
    await assert.rejects(writeProtokollSource('restore', [], source), /FILE_MISSING/);
  }
);

dbTest(
  'restore resumes after Graph succeeded but verification failed, including SQL-created files',
  async (t) => {
    overrideConfig(t, CONFIG.protokolle, { folderPath: 'Protokolle/Leitendenrunde' });
    const item = driveItem({});
    await importProtokollMetadata('partial-restore', []);
    await activateProtokolle(async () => {});
    await getDb()
      .insertInto('organisation.protokoll')
      .values({
        drive_id: 'partial-restore',
        item_id: item.id,
        fields: '{"Status":"Entwurf"}',
        legacy_fields: null,
        legacy_etag: null,
      })
      .execute();
    await freezeProtokolle();
    let fail = true;
    let writes = 0;
    const source = {
      read: async () => {
        if (writes && fail) throw new Error('Graph unavailable');
        return structuredClone(item);
      },
      write: async (_id: string, fields: Record<string, string | null>) => {
        writes++;
        item.listItem.fields = Object.fromEntries(
          Object.entries(fields).filter(([, value]) => value !== null)
        );
      },
    };
    await assert.rejects(
      writeProtokollSource('partial-restore', [item], source),
      /Graph unavailable/
    );
    await assert.rejects(
      withProtokollGate(async () => true),
      ProtokollMaintenanceError
    );
    fail = false;
    await writeProtokollSource('partial-restore', [item], source);
    assert.equal(writes, 1);
    await verifyProtokollImport('partial-restore', [item]);
  }
);
