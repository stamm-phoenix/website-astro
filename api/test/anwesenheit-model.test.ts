import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { attendanceSnapshot } from '../lib/anwesenheit-model';

const INPUT = {
  children: [
    { id: 'per_IjK123', status: 'anwesend' as const },
    { id: 'per_igA456', status: 'entschuldigt' as const },
  ],
  guests: [
    { id: '12', name: 'Gast' },
    { id: '2', name: 'Anderer Gast' },
  ],
  anonymized: 1,
  anonymizedExcused: 2,
  anonymizedGuests: 3,
};

test('attendance snapshots are independent of the browser or server language', () => {
  const snapshots = ['en_US.UTF-8', 'tr_TR.UTF-8'].map((locale) => {
    const script = `
      const { attendanceSnapshot } = require(${JSON.stringify(resolve(__dirname, '../lib/anwesenheit-model.js'))});
      process.stdout.write(JSON.stringify({
        locale: new Intl.Collator().resolvedOptions().locale,
        snapshot: attendanceSnapshot(${JSON.stringify(INPUT)})
      }));
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, LANG: locale, LC_ALL: locale },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as { locale: string; snapshot: string };
    assert.ok(output.locale.startsWith(locale.slice(0, 2)), output.locale);
    return output.snapshot;
  });
  assert.equal(snapshots[0], snapshots[1]);
  assert.equal(snapshots[0], attendanceSnapshot(INPUT));
  assert.equal(
    attendanceSnapshot(INPUT),
    attendanceSnapshot({
      ...INPUT,
      children: [...INPUT.children].reverse(),
      guests: [...INPUT.guests].reverse(),
    })
  );
  assert.notEqual(
    attendanceSnapshot(INPUT),
    attendanceSnapshot({
      ...INPUT,
      children: INPUT.children.map((child) => ({ ...child, status: 'anwesend' })),
    })
  );
});
