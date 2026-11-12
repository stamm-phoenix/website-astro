const { test } = require('node:test');
const assert = require('node:assert/strict');
const { timingTable, logComment, seconds, report } = require('./ci-comments.cjs');
const job = (name, duration, conclusion = 'success') => ({ name, conclusion, started_at: '2026-11-12T00:00:00Z', completed_at: `2026-11-12T00:00:${String(duration).padStart(2, '0')}Z` });
test('compares actual job times, marks skipped and missing jobs without invented zeroes', () => {
  const table = timingTable([job('Build', 20), job('main only', 5)], [job('Build', 25), job('skip', 1, 'skipped')]);
  assert.match(table, /Build \| 20.0 s \| 25.0 s \| \+5.0 s/);
  assert.match(table, /main only \| 5.0 s \| — \| —/);
  assert.match(table, /skip \| — \| — \| —/);
  assert.equal(seconds({}), null);
});
test('concatenates logs, escapes markup and bounds large comments with log tail', () => {
  const run = { workflow_id: 42, name: 'CI', html_url: 'https://github.com/run/1', run_attempt: 2 };
  const body = logComment(run, [{ name: 'A', text: '<script>oops</script>' }, { name: 'B', text: 'x'.repeat(100000) + 'FINAL ERROR' }]);
  assert.ok(body.length < 65000);
  assert.match(body, /&lt;script&gt;/);
  assert.match(body, /FINAL ERROR/);
  assert.match(body, /Versuch 2/);
  assert.match(body, /### A/);
  assert.match(body, /### B/);
});
test('does not write comments for stale PR heads or non-PR runs', async () => {
  let writes = 0;
  const github = { rest: { pulls: { get: async () => ({ data: { state: 'open', base: { repo: { full_name: 'o/r' } }, head: { sha: 'new' } } }) }, issues: { createComment: () => writes++ } } };
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { workflow_run: { event: 'push' } } };
  await report({ github, context });
  context.payload.workflow_run = { event: 'pull_request', head_sha: 'old', pull_requests: [{ number: 1 }] };
  await report({ github, context });
  assert.equal(writes, 0);
});
test('publishes timing and unavailable logs; updates the existing failure comment', async () => {
  const writes = [];
  const run = { id: 10, workflow_id: 42, name: 'Azure Static Web Apps CI/CD', event: 'pull_request', head_sha: 'abc1234', head_repository: { full_name: 'o/r' }, pull_requests: [{ number: 7 }], conclusion: 'failure', run_attempt: 2, created_at: '2026-11-12T00:00:00Z', html_url: 'https://github.com/o/r/actions/runs/10' };
  const actions = {
    listWorkflowRuns: async () => ({ data: { workflow_runs: [{ id: 9, head_sha: 'base123', html_url: 'https://github.com/o/r/actions/runs/9' }] } }),
    listJobsForWorkflowRun: 'jobs', listJobsForWorkflowRunAttempt: 'attemptJobs',
    downloadJobLogsForWorkflowRun: async () => { throw { status: 404 }; },
  };
  const github = { rest: { actions, pulls: { get: async () => ({ data: { number: 7, state: 'open', base: { repo: { full_name: 'o/r' } }, head: { sha: 'abc1234', repo: { full_name: 'o/r' } } } }) }, issues: {
    listComments: 'comments', createComment: async args => writes.push(args), updateComment: async args => writes.push(args),
  } }, paginate: async (endpoint, args) => {
    if (endpoint === 'jobs') return [job('Build', args.run_id === 9 ? 20 : 25)];
    if (endpoint === 'attemptJobs') return [{ id: 100, name: 'Build', conclusion: 'failure' }];
    if (endpoint === 'comments') return [{ id: 99, user: { type: 'Bot' }, body: '<!-- ci-report:42 -->\nold' }];
    throw Error('Unexpected endpoint');
  } };
  await report({ github, context: { repo: { owner: 'o', repo: 'r' }, payload: { workflow_run: run } }, core: { warning() {} } });
  assert.equal(writes.length, 2);
  assert.match(writes[0].body, /Build \| 20.0 s \| 25.0 s \| \+5.0 s/);
  assert.equal(writes[1].comment_id, 99);
  assert.match(writes[1].body, /Logs nicht verfügbar/);
});
