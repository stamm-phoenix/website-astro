import assert from 'node:assert/strict';
import { dbTest } from './fixtures/database';
import {
  createGruppenstunde,
  getStaffGruppenstunden,
  getGruppenstunden,
  updateGruppenstunde,
} from '../lib/gruppenstunden-list';
import { VersionConflictError } from '../lib/db';

const regular = {
  stufe: 'Wölflinge',
  weekday: 'Montags',
  time: '18 Uhr',
  location: 'Heim',
  description: '',
  ageRange: '',
};
const exception = {
  startDate: '2026-11-02',
  endDate: '2026-11-08',
  message: 'Entfällt diese Woche',
  location: '',
  time: '',
};
dbTest(
  'temporary notice survives storage, old clients and version conflicts, and can be removed',
  async () => {
    const id = await createGruppenstunde({ ...regular, exception }, 'test');
    const saved = (await getStaffGruppenstunden()).find((item) => item.id === id)!;
    assert.deepEqual(saved.exception, exception);
    assert.equal(saved.time, '18 Uhr');
    assert.deepEqual(
      (await getGruppenstunden()).find((item) => item.id === id)?.exception,
      exception
    );
    await updateGruppenstunde(Number(id), regular, saved.etag, 'test');
    const fresh = (await getStaffGruppenstunden()).find((item) => item.id === id)!;
    assert.deepEqual(fresh.exception, exception);
    await assert.rejects(
      updateGruppenstunde(Number(id), { ...regular, exception: null }, saved.etag, 'test'),
      VersionConflictError
    );
    await updateGruppenstunde(Number(id), { ...regular, exception: null }, fresh.etag, 'test');
    const removed = (await getStaffGruppenstunden()).find((item) => item.id === id)!;
    assert.equal(removed.exception, null);
    assert.equal(removed.time, '18 Uhr');
  }
);
