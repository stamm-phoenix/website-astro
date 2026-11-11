import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyQueueRuns, lookupQueueRun } from '../scripts/ci/queue-run';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const run = (fields: Record<string, unknown>): Record<string, unknown> => ({
  event: 'merge_group',
  head_sha: SHA,
  head_branch: `gh-readonly-queue/main/pr-12-${OTHER}`,
  status: 'completed',
  conclusion: 'success',
  ...fields,
});
const body = (...runs: Record<string, unknown>[]): unknown => ({ workflow_runs: runs });

test('only a successful queue run for exactly this commit counts as tested', () => {
  assert.equal(classifyQueueRuns(body(run({})), SHA), 'tested');
  assert.equal(classifyQueueRuns(body(run({ conclusion: 'failure' }), run({})), SHA), 'tested');
  assert.equal(classifyQueueRuns(body(), SHA), 'untested');
  for (const fields of [
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { head_sha: OTHER },
    { event: 'push' },
    { event: 'pull_request' },
    { head_branch: 'main' },
    { head_branch: `gh-readonly-queue/other/pr-1-${SHA}` },
  ]) {
    assert.equal(classifyQueueRuns(body(run(fields)), SHA), 'untested', JSON.stringify(fields));
  }
});

test('a queue run that is still running is pending, an odd answer unknown', () => {
  assert.equal(
    classifyQueueRuns(body(run({ status: 'in_progress', conclusion: null })), SHA),
    'pending'
  );
  for (const answer of [null, 'text', {}, { workflow_runs: 'x' }]) {
    assert.equal(classifyQueueRuns(answer, SHA), 'unknown', JSON.stringify(answer));
  }
});

const ENV = { GH_TOKEN: 'token', GITHUB_REPOSITORY: 'org/repo', GITHUB_SHA: SHA };
const answer = (status: number, json: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;
const quiet = { log: (): void => undefined, wait: async (): Promise<void> => undefined };

test('the lookup asks for queue runs of this commit and fails safe', async () => {
  let url = '';
  const fetchFn = (async (input: string | URL | Request) => {
    url = String(input);
    return new Response(JSON.stringify(body(run({}))));
  }) as unknown as typeof fetch;
  assert.equal(await lookupQueueRun(ENV, { ...quiet, fetch: fetchFn }), 'tested');
  assert.match(
    url,
    /\/repos\/org\/repo\/actions\/workflows\/azure-static-web-apps-[^/]+\.yml\/runs\?/
  );
  assert.match(url, new RegExp(`event=merge_group&head_sha=${SHA}`));

  assert.equal(await lookupQueueRun(ENV, { ...quiet, fetch: answer(200, body()) }), 'untested');
  assert.equal(await lookupQueueRun(ENV, { ...quiet, fetch: answer(403, {}) }), 'unknown');
  assert.equal(await lookupQueueRun(ENV, { ...quiet, fetch: answer(200, 'x') }), 'unknown');
  const failing = (async () => {
    throw new Error('network');
  }) as unknown as typeof fetch;
  assert.equal(await lookupQueueRun(ENV, { ...quiet, fetch: failing }), 'unknown');
  for (const missing of ['GH_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_SHA']) {
    const env = { ...ENV, [missing]: '' };
    assert.equal(await lookupQueueRun(env, { ...quiet, fetch: failing }), 'unknown', missing);
  }
});

test('the lookup waits for a running queue run, then gives up as untested', async () => {
  const answers = [
    body(run({ status: 'in_progress', conclusion: null })),
    body(run({ status: 'in_progress', conclusion: null })),
    body(run({})),
  ];
  let calls = 0;
  const fetchFn = (async () =>
    new Response(JSON.stringify(answers[calls++]))) as unknown as typeof fetch;
  assert.equal(await lookupQueueRun(ENV, { ...quiet, fetch: fetchFn }), 'tested');
  assert.equal(calls, 3);

  const running = answer(200, body(run({ status: 'queued', conclusion: null })));
  assert.equal(await lookupQueueRun(ENV, { ...quiet, fetch: running, attempts: 3 }), 'untested');
});
