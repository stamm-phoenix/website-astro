import type { TestContext } from 'node:test';
import { getDb } from '../../lib/db';
import type { NikolausSettings } from '../../lib/nikolaus-config';
import * as settingsModule from '../../lib/nikolaus-settings';

/** The settings as seeded by `migrations/0002_nikolaus_settings.sql`. */
export const TEST_SETTINGS: NikolausSettings = {
  publicActive: false,
  staffActive: true,
  maintenance: false,
  pendingHoldMinutes: 120,
  changeDeadlineHours: 24,
  days: [
    { date: '2026-12-05', start: '17:00', end: '21:00', teams: 2 },
    { date: '2026-12-06', start: '17:00', end: '21:00', teams: 3 },
  ],
  area: {
    base: { name: 'Pfarrheim', lat: 47.90885, lon: 11.84664 },
    servicePostalCodes: ['83620', '83052'],
    farDistanceKm: 8,
  },
};

type Switches = Partial<
  Pick<
    NikolausSettings,
    'publicActive' | 'staffActive' | 'maintenance' | 'pendingHoldMinutes' | 'changeDeadlineHours'
  >
>;

/** For tests without a database: the settings come from here instead. */
export function mockNikolausSettings(t: TestContext, patch: Switches = {}): void {
  t.mock.method(settingsModule, 'getNikolausSettings', async () => ({
    ...TEST_SETTINGS,
    ...patch,
  }));
}

/** Changes switches in the test database (inside `dbTest`). */
export async function updateNikolausSettings(patch: Switches): Promise<void> {
  await getDb()
    .updateTable('nikolaus.settings')
    .set({
      ...(patch.publicActive !== undefined && { public_active: patch.publicActive }),
      ...(patch.staffActive !== undefined && { staff_active: patch.staffActive }),
      ...(patch.maintenance !== undefined && { maintenance: patch.maintenance }),
      ...(patch.pendingHoldMinutes !== undefined && {
        pending_hold_minutes: patch.pendingHoldMinutes,
      }),
      ...(patch.changeDeadlineHours !== undefined && {
        change_deadline_hours: patch.changeDeadlineHours,
      }),
    })
    .where('id', '=', 1)
    .execute();
}
