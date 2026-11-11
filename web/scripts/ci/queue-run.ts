/**
 * Whether the merge queue already tested a commit of main (#568): looks for a successful
 * `merge_group` run of the main workflow whose head is exactly this commit. Used by
 * `plan-jobs.ts` on pushes, so main does not run the tests the queue just ran.
 *
 * GitHub does not document that main gets the very commit the queue tested, so nothing relies on
 * it: if the commit differs, no run matches and the push tests everything. Fails safe the same way
 * for every error or doubt.
 */

/** `tested`: a successful queue run for this commit; `unknown`: the lookup failed. */
export type QueueState = 'tested' | 'untested' | 'unknown';

const WORKFLOW = 'azure-static-web-apps-zealous-water-04f606303.yml';
/** Branches of the merge queue for main (`gh-readonly-queue/main/pr-<n>-<sha>`) */
const QUEUE_BRANCH = 'gh-readonly-queue/main/';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Classifies the answer of `GET …/actions/workflows/<file>/runs`. `pending`: a queue run for this
 * commit has not finished yet (the queue merges as soon as the required checks pass, which can be
 * a moment before the run is marked completed).
 */
export function classifyQueueRuns(body: unknown, sha: string): QueueState | 'pending' {
  const runs = isObject(body) ? body.workflow_runs : undefined;
  if (!Array.isArray(runs)) return 'unknown';
  const queueRuns = runs
    .filter(isObject)
    .filter(
      (run) =>
        run.event === 'merge_group' &&
        run.head_sha === sha &&
        typeof run.head_branch === 'string' &&
        run.head_branch.startsWith(QUEUE_BRANCH)
    );
  if (queueRuns.some((run) => run.status === 'completed' && run.conclusion === 'success')) {
    return 'tested';
  }
  return queueRuns.some((run) => run.status !== 'completed') ? 'pending' : 'untested';
}

export interface LookupOptions {
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  /** Requests while a queue run is still pending */
  attempts?: number;
  log?: (message: string) => void;
}

/**
 * Asks the GitHub API with `GH_TOKEN` (needs `actions: read`) about `GITHUB_SHA`. Missing
 * variables, a failed request or an unexpected answer give `unknown`; a queue run that does not
 * finish within about two minutes gives `untested`.
 */
export async function lookupQueueRun(
  env: Record<string, string | undefined>,
  {
    fetch: fetchFn = fetch,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    attempts = 8,
    log = (message) => console.error(message),
  }: LookupOptions = {}
): Promise<QueueState> {
  const { GH_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_SHA: sha } = env;
  const api = env.GITHUB_API_URL || 'https://api.github.com';
  if (!token || !repo || !sha || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[0-9a-f]{40}$/.test(sha)) {
    log('Merge queue lookup: GH_TOKEN, GITHUB_REPOSITORY or GITHUB_SHA missing.');
    return 'unknown';
  }
  const url = `${api}/repos/${repo}/actions/workflows/${WORKFLOW}/runs?event=merge_group&head_sha=${sha}&per_page=100`;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let state: QueueState | 'pending';
    try {
      const response = await fetchFn(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        log(`Merge queue lookup: HTTP ${response.status}.`);
        return 'unknown';
      }
      state = classifyQueueRuns(await response.json(), sha);
    } catch (error) {
      log(`Merge queue lookup failed: ${String(error)}`);
      return 'unknown';
    }
    if (state !== 'pending') return state;
    if (attempt < attempts) {
      log('Merge queue lookup: the queue run of this commit is still running, waiting.');
      await wait(15_000);
    }
  }
  log('Merge queue lookup: the queue run of this commit did not finish in time.');
  return 'untested';
}
