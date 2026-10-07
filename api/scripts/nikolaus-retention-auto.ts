/** Scheduled operator job. No resource or environment configuration is changed here. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { closeDatabase, getSqlErrorNumber } from '../lib/db';
import { getRetentionTargetDigest } from '../lib/nikolaus-retention';
import { runAutomaticNikolausRetention } from '../lib/nikolaus-retention-auto';

function settings(): void {
  try {
    const parsed = JSON.parse(
      readFileSync(resolve(__dirname, '../local.settings.json'), 'utf8')
    ) as { Values?: Record<string, string> };
    for (const [key, value] of Object.entries(parsed.Values ?? {})) process.env[key] ??= value;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--help', '--dry-run', '--show-target'].includes(arg)))
    throw new Error('Invalid automatic retention argument');
  if (args.includes('--help')) {
    console.log(
      'Daily retention: bun scripts/nikolaus-retention-auto.ts [--dry-run | --show-target]'
    );
    console.log(
      'Writes require NIKOLAUS_RETENTION_ENABLED=true and NIKOLAUS_RETENTION_TARGET_DIGEST matching the configured database.'
    );
    return;
  }
  const targetDigest = getRetentionTargetDigest();
  if (args.includes('--show-target')) {
    console.log(`Retention target digest: ${targetDigest}`);
    return;
  }
  settings();
  const dryRun = args.includes('--dry-run');
  if (!dryRun && process.env.NIKOLAUS_RETENTION_ENABLED !== 'true') {
    console.log('Automatic Nikolaus retention is disabled. No data accessed or changed.');
    return;
  }
  const result = await runAutomaticNikolausRetention(
    { targetDigest, expectedTargetDigest: process.env.NIKOLAUS_RETENTION_TARGET_DIGEST ?? '' },
    { dryRun }
  );
  // Full reports stay in the database (state `retention:run:<season>`). CI output has counts only.
  console.log(
    JSON.stringify({
      scope: 'nikolaus_retention',
      status: result.status,
      dueSeasons: result.dueSeasons,
      unclassifiedRecords: result.unclassified.length,
      plannedBookings: result.plans.reduce((count, plan) => count + plan.bookingIds.length, 0),
      plannedHelpers: result.plans.reduce((count, plan) => count + plan.helperIds.length, 0),
      deletedBookings: result.reports.reduce((count, report) => count + report.deleted.bookings, 0),
      deletedHelpers: result.reports.reduce((count, report) => count + report.deleted.helpers, 0),
      completedSeasons: result.reports.filter((report) => report.complete).length,
    })
  );
  if (result.status === 'partial') process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        scope: 'nikolaus_retention',
        status: 'failed',
        errorCode: getSqlErrorNumber(error) ?? 'UNKNOWN',
      })
    );
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
