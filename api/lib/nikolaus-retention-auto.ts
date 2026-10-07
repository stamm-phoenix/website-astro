import {
  applyNikolausRetention,
  loadRetentionSources,
  planNikolausRetention,
} from './nikolaus-retention';
import type { RetainedRecord, RetentionPlan, RetentionReport } from './nikolaus-retention';
import {
  getNikolausRetentionSchedule,
  mergeRetentionSeasonPolicy,
  retentionScheduleKey,
} from './nikolaus-retention-schedule';
import type { RetentionSeasonPolicy } from './nikolaus-retention-schedule';
import { mutateNikolausState } from './nikolaus-state';

export const RETENTION_RESPONSIBLE = 'Nico Welles';

export interface AutomaticRetentionDependencies {
  targetDigest: string;
  expectedTargetDigest: string;
}

export interface AutomaticRetentionResult {
  status: 'preview' | 'idle' | 'complete' | 'partial';
  dueSeasons: number[];
  plans: RetentionPlan[];
  reports: RetentionReport[];
  unclassified: RetainedRecord[];
}

async function savePolicy(policy: RetentionSeasonPolicy): Promise<void> {
  await mutateNikolausState(
    retentionScheduleKey(policy.season),
    (current) => current,
    (current) => mergeRetentionSeasonPolicy(current, policy)
  );
}

/** Keeps the report of the last run per season; it holds only IDs and counts. */
async function saveRun(season: number, report: RetentionReport): Promise<void> {
  await mutateNikolausState(
    `retention:run:${season}`,
    () => undefined,
    () => ({ schema: 2, report })
  );
}

/** Daily execution is opt-in at the CLI/workflow; this function never grants activation itself. */
export async function runAutomaticNikolausRetention(
  dependencies: AutomaticRetentionDependencies,
  options: { dryRun: boolean; now?: Date }
): Promise<AutomaticRetentionResult> {
  const now = options.now ?? new Date();
  if (
    !/^[a-f0-9]{64}$/.test(dependencies.expectedTargetDigest) ||
    dependencies.targetDigest !== dependencies.expectedTargetDigest
  ) {
    throw new Error('Automatic retention target was not explicitly configured');
  }
  const sources = await loadRetentionSources();
  const schedule = getNikolausRetentionSchedule(sources, now);
  const result: AutomaticRetentionResult = {
    status: options.dryRun ? 'preview' : 'idle',
    dueSeasons: schedule.duePolicies.map((policy) => policy.season),
    plans: [],
    reports: [],
    unclassified: schedule.unclassified,
  };
  if (options.dryRun) {
    for (const policy of schedule.duePolicies) {
      result.plans.push(
        planNikolausRetention(sources, {
          season: policy.season,
          before: policy.before,
          responsibleRole: RETENTION_RESPONSIBLE,
        })
      );
    }
    return result;
  }
  // Persist deadlines even before they are due, so a later partial cleanup cannot shorten them.
  for (const policy of schedule.policies) await savePolicy(policy);
  for (const policy of schedule.duePolicies) {
    const report = await applyNikolausRetention(
      { season: policy.season, before: policy.before, responsibleRole: RETENTION_RESPONSIBLE },
      now
    );
    result.reports.push(report);
    await saveRun(policy.season, report);
    if (!report.complete) result.status = 'partial';
  }
  if (result.status !== 'partial') {
    result.status = result.unclassified.length
      ? 'partial'
      : result.reports.length
        ? 'complete'
        : 'idle';
  }
  return result;
}
