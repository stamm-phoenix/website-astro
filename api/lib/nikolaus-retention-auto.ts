import { randomUUID } from 'node:crypto';
import { applyNikolausRetention, planNikolausRetention } from './nikolaus-retention';
import type { RetentionBackend, RetentionPlan, RetentionReport } from './nikolaus-retention';
import {
  getNikolausRetentionSchedule,
  mergeRetentionSeasonPolicy,
  retentionScheduleKey,
} from './nikolaus-retention-schedule';
import type { RetentionSeasonPolicy } from './nikolaus-retention-schedule';
import { mutateNikolausState } from './nikolaus-state';
import { beginNikolausMaintenance, endNikolausMaintenance } from './nikolaus-write-gate';

export interface AutomaticRetentionDependencies {
  backend: RetentionBackend;
  targetDigest: string;
  expectedTargetDigest: string;
  verifyDeployment: (owner: string) => Promise<void>;
  savePolicy?: (policy: RetentionSeasonPolicy) => Promise<void>;
  saveRun?: (season: number, value: unknown) => Promise<void>;
  beginMaintenance?: typeof beginNikolausMaintenance;
  endMaintenance?: typeof endNikolausMaintenance;
}

export interface AutomaticRetentionResult {
  status: 'preview' | 'idle' | 'busy' | 'complete' | 'partial';
  dueSeasons: number[];
  plans: RetentionPlan[];
  reports: RetentionReport[];
  unclassified: RetentionPlan['retained'];
}

async function savePolicy(policy: RetentionSeasonPolicy): Promise<void> {
  await mutateNikolausState(
    retentionScheduleKey(policy.season),
    (current) => current,
    (current) => mergeRetentionSeasonPolicy(current, policy)
  );
}

async function saveRun(season: number, value: unknown): Promise<void> {
  await mutateNikolausState(
    `retention:run:${season}`,
    () => value,
    (current) => current
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
  const initial = getNikolausRetentionSchedule(await dependencies.backend.load(), now);
  const result: AutomaticRetentionResult = {
    status: options.dryRun ? 'preview' : 'idle',
    dueSeasons: initial.duePolicies.map((policy) => policy.season),
    plans: [],
    reports: [],
    unclassified: initial.unclassified,
  };
  if (options.dryRun) {
    const sources = await dependencies.backend.load();
    for (const policy of initial.duePolicies) {
      result.plans.push(
        planNikolausRetention(
          sources,
          { season: policy.season, before: policy.before, responsibleRole: 'Nico Welles' },
          dependencies.targetDigest,
          now
        )
      );
    }
    return result;
  }
  // Persist deadlines even before they are due, so a later partial cleanup cannot shorten them.
  const persistPolicy = dependencies.savePolicy ?? savePolicy;
  for (const policy of initial.policies) await persistPolicy(policy);
  if (initial.unclassified.length) result.status = 'partial';
  if (initial.duePolicies.length === 0) return result;
  const owner = randomUUID();
  const begin = dependencies.beginMaintenance ?? beginNikolausMaintenance;
  const end = dependencies.endMaintenance ?? endNikolausMaintenance;
  const persistRun = dependencies.saveRun ?? saveRun;
  try {
    const maintenance = await begin(owner);
    if (!maintenance.ready) {
      result.status = 'busy';
      return result;
    }
    await dependencies.verifyDeployment(owner);
    // Re-read under the gate: a writer admitted before the claim may have postponed the season.
    const schedule = getNikolausRetentionSchedule(await dependencies.backend.load(), now);
    result.dueSeasons = schedule.duePolicies.map((policy) => policy.season);
    result.unclassified = schedule.unclassified;
    for (const policy of schedule.policies) await persistPolicy(policy);
    for (const policy of schedule.duePolicies) {
      const plan = planNikolausRetention(
        await dependencies.backend.load(),
        { season: policy.season, before: policy.before, responsibleRole: 'Nico Welles' },
        dependencies.targetDigest,
        now
      );
      result.plans.push(plan);
      await persistRun(policy.season, {
        schema: 1,
        owner,
        policy,
        plan,
        status: 'started',
        startedAt: now.toISOString(),
      });
      const report = await applyNikolausRetention(
        plan,
        dependencies.targetDigest,
        {
          ...dependencies.backend,
          persistReport: async (progress) => {
            await persistRun(policy.season, {
              schema: 1,
              owner,
              policy,
              plan,
              report: progress,
              status: progress.complete ? 'complete' : 'in_progress',
            });
          },
        },
        now
      );
      result.reports.push(report);
      await persistRun(policy.season, {
        schema: 1,
        owner,
        policy,
        plan,
        report,
        status: report.complete ? 'complete' : 'partial',
      });
      if (!report.complete) {
        result.status = 'partial';
        return result;
      }
    }
    result.status = result.unclassified.length
      ? 'partial'
      : result.reports.length
        ? 'complete'
        : 'idle';
    return result;
  } finally {
    // Also releases our own ambiguous claim. A different owner's maintenance is never removed.
    await end(owner);
  }
}
