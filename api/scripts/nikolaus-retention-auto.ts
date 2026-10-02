/** Scheduled operator job. No resource or environment configuration is changed here. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createNikolausRetentionBackend } from '../lib/nikolaus-retention-backend';
import { runAutomaticNikolausRetention } from '../lib/nikolaus-retention-auto';
import { verifyNikolausMaintenanceDeployment } from '../lib/nikolaus-retention-deployment';
import { getGraphStatus } from '../lib/sharepoint-data-access';

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
      'Writes require NIKOLAUS_RETENTION_ENABLED=true, an explicitly bound target and deployed maintenance gates.'
    );
    return;
  }
  settings();
  const dryRun = args.includes('--dry-run');
  if (
    !dryRun &&
    !args.includes('--show-target') &&
    process.env.NIKOLAUS_RETENTION_ENABLED !== 'true'
  ) {
    console.log('Automatic Nikolaus retention is disabled. No data accessed or changed.');
    return;
  }
  const { targetDigest, backend } = createNikolausRetentionBackend();
  if (args.includes('--show-target')) {
    console.log(`Retention target digest: ${targetDigest}`);
    return;
  }
  const result = await runAutomaticNikolausRetention(
    {
      backend,
      targetDigest,
      expectedTargetDigest: process.env.NIKOLAUS_RETENTION_TARGET_DIGEST ?? '',
      verifyDeployment: (owner) =>
        verifyNikolausMaintenanceDeployment(
          process.env.NIKOLAUS_RETENTION_AZURE_RESOURCE_ID ?? '',
          owner
        ),
    },
    { dryRun }
  );
  // Full plans/reports remain in the private state list. Public CI output contains counts only.
  console.log(
    JSON.stringify({
      scope: 'nikolaus_retention',
      status: result.status,
      dueSeasons: result.dueSeasons,
      unclassifiedRecords: result.unclassified.length,
      reviewedOperations: result.plans.reduce((count, plan) => count + plan.operations.length, 0),
      completedSeasons: result.reports.filter((report) => report.complete).length,
    })
  );
  if (result.status === 'partial' || result.status === 'busy') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      scope: 'nikolaus_retention',
      status: 'failed',
      errorCode: getGraphStatus(error) ?? 'UNKNOWN',
    })
  );
  process.exitCode = 1;
});
