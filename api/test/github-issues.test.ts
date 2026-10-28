import assert from 'node:assert/strict';
import test from 'node:test';
import { findGithubIssue, GithubIssueError } from '../lib/github-issues';
import { issueFooter } from '../lib/problemmeldung-model';

test('an edited issue retaining the report marker cannot be treated as absent', async (t) => {
  const previous = process.env.GITHUB_ISSUES_TOKEN;
  process.env.GITHUB_ISSUES_TOKEN = 'test-token';
  t.after(() => {
    if (previous === undefined) delete process.env.GITHUB_ISSUES_TOKEN;
    else process.env.GITHUB_ISSUES_TOKEN = previous;
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(
      JSON.stringify([
        {
          number: 77,
          html_url: 'https://github.com/stamm-phoenix/website-astro/issues/77',
          title: 'Neuer Titel',
          body: `Geänderter Text\n\n${issueFooter(12)}`,
        },
      ])
    );
  });
  await assert.rejects(
    findGithubIssue(12, new Date(), { title: 'Alter Titel', body: 'Alter Text' }),
    (error: unknown) => error instanceof GithubIssueError && error.failure === 'needs-review'
  );
  assert.equal(calls, 1);
});
