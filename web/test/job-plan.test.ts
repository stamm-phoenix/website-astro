import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatPlan, planJobs } from '../scripts/ci/job-plan';
import type { JobPlan } from '../scripts/ci/job-plan';

const jobs = (plan: JobPlan): Omit<JobPlan, 'reason'> => ({
  web: plan.web,
  api_tests: plan.api_tests,
  api_package: plan.api_package,
  browser: plan.browser,
  preview: plan.preview,
});
const ALL = { web: true, api_tests: true, api_package: true, browser: true, preview: true };
const NONE = { web: false, api_tests: false, api_package: false, browser: false, preview: false };
const WEB = { web: true, api_tests: false, api_package: false, browser: true, preview: true };

test('runs everything for every event but a pull request', () => {
  for (const event of ['push', 'merge_group', 'workflow_dispatch', '']) {
    assert.deepEqual(jobs(planJobs(event, ['docs/readme.md'])), ALL, event);
  }
});

test('runs everything when the diff is unreadable or empty', () => {
  assert.deepEqual(jobs(planJobs('pull_request', undefined)), ALL);
  assert.deepEqual(jobs(planJobs('pull_request', [])), ALL);
});

test('runs everything when a file changes how CI builds', () => {
  for (const file of [
    '.github/workflows/browser-tests.yml',
    '.github/actions/swa-upload/action.yml',
    'package.json',
    'web/package.json',
    'api/package.json',
    'web/bun.lock',
    'api/bun.lock',
    'flake.nix',
    'flake.lock',
    'scripts/package-swa-api.sh',
  ]) {
    assert.deepEqual(jobs(planJobs('pull_request', ['docs/a.md', file])), ALL, file);
  }
});

test('skips everything for documentation only', () => {
  assert.deepEqual(
    jobs(
      planJobs('pull_request', [
        'docs/azure-sql.md',
        'docs/ui/bild.png',
        'AGENTS.md',
        'web/README.md',
      ])
    ),
    NONE
  );
});

test('skips the API tests and the package build without API changes', () => {
  assert.deepEqual(
    jobs(
      planJobs('pull_request', ['web/src/pages/index.astro', 'web/tests/home.spec.ts', 'docs/a.md'])
    ),
    WEB
  );
  assert.deepEqual(jobs(planJobs('pull_request', ['.gitignore'])), WEB);
});

test('runs the API and the website jobs for API changes', () => {
  for (const file of ['api/lib/config.ts', 'api/test/db.test.ts', 'infrastructure/main.bicep']) {
    assert.deepEqual(jobs(planJobs('pull_request', [file])), ALL, file);
  }
  assert.deepEqual(jobs(planJobs('pull_request', ['api/lib/config.ts', 'web/src/x.ts'])), ALL);
});

test('formats the plan for $GITHUB_OUTPUT', () => {
  assert.equal(
    formatPlan(planJobs('pull_request', ['web/src/x.ts'])),
    'web=true\napi_tests=false\napi_package=false\nbrowser=true\npreview=true\n'
  );
});

test('the command runs everything when the diff fails', () => {
  const run = (...args: string[]): string =>
    spawnSync(process.execPath, ['scripts/ci/plan-jobs.ts', ...args], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
    }).stdout;
  assert.equal(run('pull_request', 'no-such-commit'), formatPlan(planJobs('push', undefined)));
  assert.equal(run('pull_request'), formatPlan(planJobs('push', undefined)));
  assert.equal(run('push'), formatPlan(planJobs('push', undefined)));
});
