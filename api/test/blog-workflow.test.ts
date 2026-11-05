import assert from 'node:assert/strict';
import test from 'node:test';
import { nextBlogWorkflow, transitionBlog } from '../lib/blog-workflow';
import { readBlogWorkflow } from '../lib/blog-workflow-read';
import type { ClientPrincipal } from '../lib/staff-auth';
const author: ClientPrincipal = {
  identityProvider: 'aad',
  userId: 'a',
  userDetails: 'a@example.test',
  userRoles: ['team_leitende'],
};
const reviewer = { ...author, userId: 'b', userDetails: 'b@example.test' };
test('draft requires independent review before publication, recording actors and times', () => {
  const draft = { state: 'draft' as const };
  assert.throws(() => nextBlogWorkflow(draft, 'publish', author, author.userDetails));
  const submitted = nextBlogWorkflow(draft, 'submit', author, author.userDetails);
  assert.throws(() => nextBlogWorkflow(submitted, 'approve', author, author.userDetails));
  const approved = nextBlogWorkflow(submitted, 'approve', reviewer, author.userDetails);
  assert.equal(approved.reviewed?.by, 'b');
  assert.ok(approved.reviewed?.at);
  const published = nextBlogWorkflow(approved, 'publish', author, author.userDetails);
  assert.equal(published.state, 'published');
  assert.equal(published.publication?.by, 'a');
  assert.equal(nextBlogWorkflow(published, 'unpublish', author, author.userDetails).state, 'draft');
});
test('return requires feedback and author must submit again', () => {
  const submitted = nextBlogWorkflow({ state: 'draft' }, 'submit', author, author.userDetails);
  assert.throws(() => nextBlogWorkflow(submitted, 'return', reviewer, author.userDetails));
  const returned = nextBlogWorkflow(
    submitted,
    'return',
    reviewer,
    author.userDetails,
    'Bitte Datum prüfen.'
  );
  assert.equal(returned.state, 'draft');
  assert.equal(returned.feedback, 'Bitte Datum prüfen.');
  assert.throws(() => nextBlogWorkflow(returned, 'approve', reviewer, author.userDetails));
});
test('legacy publications remain visible and malformed metadata fails closed', () => {
  assert.equal(readBlogWorkflow(null, true).state, 'published');
  assert.equal(readBlogWorkflow('{', true).state, 'draft');
});

test('invalid workflow requests name their fields in German before database access', async () => {
  await assert.rejects(transitionBlog('1', { action: 'publish' }, author), (error: unknown) => {
    assert.ok(error instanceof Error && 'fields' in error);
    assert.deepEqual(error.fields, { etag: 'Bitte den aktuellen Beitrag neu laden.' });
    return true;
  });
  await assert.rejects(
    transitionBlog('1', { action: 'delete', etag: 'x' }, author),
    (error: unknown) => {
      assert.ok(error instanceof Error && 'fields' in error);
      assert.deepEqual(error.fields, { action: 'Bitte eine gültige Aktion wählen.' });
      return true;
    }
  );
});
