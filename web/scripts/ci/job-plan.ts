/**
 * Which jobs of the main workflow a change needs. Used by the job `plan`, which runs first and
 * lets the other jobs skip what a pull request cannot affect.
 *
 * Fails open: anything that is not a pull request with a readable, non-empty diff runs everything,
 * and so does every file that changes how CI itself builds (workflows, packages, lock files, the
 * Nix flake, the root scripts). Only documentation skips everything. The one exception is a push
 * of a commit that the merge queue already tested (`queue-run.ts`): it skips the tests (#568).
 */
import type { QueueState } from './queue-run';

export interface JobPlan {
  /** Build website, Check website */
  web: boolean;
  /** Check API tests (job `api`) */
  api_tests: boolean;
  /** Build the API package from source with all static checks; otherwise it may come from the cache */
  api_package: boolean;
  /** Browser tests (the job `select` of browser-tests.yml then picks the specs and shards) */
  browser: boolean;
  /** Prepare and deploy the PR preview */
  preview: boolean;
  /** Tests deselected because a successful merge queue run tested exactly this commit */
  queue_tested: boolean;
  reason: string;
}

const all = (reason: string): JobPlan => ({
  web: true,
  api_tests: true,
  api_package: true,
  browser: true,
  preview: true,
  queue_tested: false,
  reason,
});

/** Files that change how CI builds or installs anything. */
function changesCi(file: string): boolean {
  const name = file.split('/').pop() ?? '';
  return (
    file.startsWith('.github/') ||
    name === 'package.json' ||
    name === 'bun.lock' ||
    /^flake\.[^/]+$/.test(file) ||
    file.startsWith('scripts/')
  );
}

const isDocumentation = (file: string): boolean =>
  file.startsWith('docs/') || file.toLowerCase().endsWith('.md');

const changesApi = (file: string): boolean =>
  file.startsWith('api/') || file.startsWith('infrastructure/');

const QUEUE_REASON: Record<QueueState, string> = {
  tested: 'the merge queue tested this commit',
  untested: 'no successful merge queue run for this commit',
  unknown: 'merge queue lookup failed',
};

/**
 * `changed` are the paths of the diff relative to the repository root, or `undefined` when the
 * diff could not be read. `queue` is the result of the merge queue lookup on a push.
 */
export function planJobs(
  event: string,
  changed: readonly string[] | undefined,
  queue?: QueueState
): JobPlan {
  if (event === 'push' && queue === 'tested') {
    // Production still needs the website built with live content and the API package. The
    // package may come from the cache of main (its checks passed in the queue); the job
    // api-static runs for queue_tested.
    return {
      web: true,
      api_tests: false,
      api_package: false,
      browser: false,
      preview: false,
      queue_tested: true,
      reason: QUEUE_REASON.tested,
    };
  }
  if (event !== 'pull_request') {
    const detail = event === 'push' && queue ? ` (${QUEUE_REASON[queue]})` : '';
    return all(`event ${event || 'unknown'} runs everything${detail}`);
  }
  if (changed === undefined) return all('diff unreadable');
  if (changed.length === 0) return all('empty diff');
  const ci = changed.find(changesCi);
  if (ci) return all(`${ci} changes CI`);
  if (changed.every(isDocumentation)) {
    return {
      web: false,
      api_tests: false,
      api_package: false,
      browser: false,
      preview: false,
      queue_tested: false,
      reason: 'documentation only',
    };
  }
  const api = changed.some(changesApi);
  // The frontend imports api/lib (shared config, types) and the mock API, so the website jobs
  // run for API changes too. Every other change needs the website build for the preview.
  return {
    web: true,
    api_tests: api,
    api_package: api,
    browser: true,
    preview: true,
    queue_tested: false,
    reason: api ? 'API and website' : 'website without API',
  };
}

/** Lines for `$GITHUB_OUTPUT`. */
export function formatPlan(plan: JobPlan): string {
  const keys = ['web', 'api_tests', 'api_package', 'browser', 'preview', 'queue_tested'] as const;
  return keys.map((key) => `${key}=${plan[key]}`).join('\n') + '\n';
}
