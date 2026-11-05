import assert from 'node:assert/strict';
import { dbTest } from './fixtures/database';
import { getDb } from '../lib/db';
import {
  createAktion,
  getStaffAktionen,
  getStoredAktionen,
  updateAktion,
} from '../lib/aktionen-list';
import { validateAktion } from '../lib/validation/aktion';

dbTest('Aktionsunterlagen survive save and disappear after file deletion', async () => {
  await getDb()
    .insertInto('content.download')
    .values({
      id: 'unterlage',
      file_name: 'Anmeldung.pdf',
      file_key: 'testfile',
      size: 10,
      mime_type: 'application/pdf',
      updated_by: 'test',
    })
    .execute();
  const input = validateAktion(
    {
      title: 'Lager',
      start: '2027-08-01',
      stufen: ['Rover'],
      meetingPoint: 'Heim',
      packingList: ['Schlafsack'],
      downloadIds: ['unterlage'],
    },
    ['Rover']
  );
  const id = await createAktion(input, 'test');
  const entry = (await getStaffAktionen()).find((item) => item.id === id)!;
  assert.deepEqual(entry.downloadIds, ['unterlage']);
  assert.equal(entry.meetingPoint, 'Heim');
  assert.deepEqual(entry.packingList, ['Schlafsack']);
  assert.equal(
    (await getStoredAktionen()).find((item) => item.id === id)?.downloads?.[0]?.fileName,
    'Anmeldung.pdf'
  );
  await getDb().deleteFrom('content.download').where('id', '=', 'unterlage').execute();
  assert.equal(
    (await getStoredAktionen()).find((item) => item.id === id)?.downloads?.length ?? 0,
    0
  );
  await updateAktion(
    Number(id),
    { ...input, downloadIds: [], packingList: [], meetingPoint: '' },
    entry.etag,
    'test'
  );
  const cleared = (await getStaffAktionen()).find((item) => item.id === id)!;
  assert.equal(cleared.packingList, undefined);
  assert.equal(cleared.meetingPoint, undefined);
});
