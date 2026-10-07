import assert from 'node:assert/strict';
import { seedPreviewPlans } from '../lib/db-preview';
import { getAllDispoRows, getDispoVersion } from '../lib/nikolaus-dispo-list';
import { getEinteilungRows, getEinteilungVersion } from '../lib/nikolaus-einteilung-list';
import { dbTest } from './fixtures/database';
import { insertBooking, insertHelper } from './fixtures/nikolaus-data';

const DATE = '2026-12-05';

dbTest('a preview gets an Einteilung and a Dispo, and keeps them later', async () => {
  const roles = { [DATE]: ['Nikolaus', 'Krampus', 'Fahrer*in', 'Engerl'] as const };
  for (let i = 0; i < 4; i++) {
    await insertHelper({ name: `Helfer ${i}`, availability: { [DATE]: [...roles[DATE]] } });
  }
  const bookings = await Promise.all(
    ['17:00', '17:30', '18:00'].map(
      async (time) => (await insertBooking(`${DATE}T${time}`)).booking.id
    )
  );

  await seedPreviewPlans();
  const einteilung = await getEinteilungRows();
  const dispo = await getAllDispoRows();
  assert.ok(einteilung.some((row) => row.date === DATE && row.team !== 'Küche'));
  assert.deepEqual(dispo.map((row) => row.bookingId).sort(), [...bookings].sort());
  assert.ok(dispo.every((row) => row.date === DATE && /^\d\d:\d\d$/.test(row.plannedArrival)));

  // Plans that exist are kept, e.g. after reviewers changed them
  await seedPreviewPlans();
  assert.equal(getEinteilungVersion(await getEinteilungRows()), getEinteilungVersion(einteilung));
  assert.equal(getDispoVersion(await getAllDispoRows()), getDispoVersion(dispo));
});
