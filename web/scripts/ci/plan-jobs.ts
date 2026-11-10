/**
 * Prints the jobs a run needs as `$GITHUB_OUTPUT` lines (see `job-plan.ts`), and the reason on
 * stderr. Used by the job `plan` of the main workflow.
 *
 * `bun scripts/ci/plan-jobs.ts <event> [<base>]` compares the checkout with `<base>` (in CI the
 * first parent of the merge commit, `HEAD^1`). Any error prints a plan that runs everything.
 */
import { resolve } from 'node:path';
import { readChangedFiles } from './changed-files';
import { formatPlan, planJobs } from './job-plan';
import type { JobPlan } from './job-plan';

const [event = '', base] = process.argv.slice(2);
let plan: JobPlan;
try {
  const changed =
    event === 'pull_request' && base ? readChangedFiles(resolve('..'), base).files : undefined;
  plan = planJobs(event, changed);
} catch (error) {
  plan = planJobs('', undefined);
  plan.reason = `plan failed: ${String(error)}`;
}
process.stdout.write(formatPlan(plan));
console.error(`Plan: ${plan.reason}`);
