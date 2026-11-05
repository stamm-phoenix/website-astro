import assert from 'node:assert/strict';
import { dbTest } from './fixtures/database';
import { createBlogPost, getBlogEntry, saveBlogImages, updateBlogPost } from '../lib/blog-list';
import { transitionBlog } from '../lib/blog-workflow';
import { GetBlogEndpoint } from '../endpoints/blog';
import type { ClientPrincipal } from '../lib/staff-auth';
const author: ClientPrincipal = {
  identityProvider: 'aad',
  userId: 'author',
  userDetails: 'author@example.test',
  userRoles: ['team_leitende'],
};
const reviewer = { ...author, userId: 'reviewer', userDetails: 'reviewer@example.test' };
const input = {
  title: 'Prüfbeitrag',
  date: '2026-11-05',
  content: '<p>Inhalt</p>',
  published: true,
};
dbTest(
  'publication cannot be bypassed, stale approval fails and content/image edits revoke publication',
  async () => {
    const created = await createBlogPost(input, author.userDetails);
    const { id } = created;
    assert.deepEqual((await GetBlogEndpoint()).jsonBody, []);
    await assert.rejects(transitionBlog(id, { action: 'publish', etag: created.etag }, author));
    await assert.rejects(transitionBlog(id, { action: 'submit' }, author));
    const submitted = await transitionBlog(id, { action: 'submit', etag: created.etag }, author);
    await assert.rejects(transitionBlog(id, { action: 'approve', etag: submitted.etag }, author));
    await assert.rejects(transitionBlog(id, { action: 'approve', etag: created.etag }, reviewer));
    const approved = await transitionBlog(
      id,
      { action: 'approve', etag: submitted.etag },
      reviewer
    );
    const published = await transitionBlog(id, { action: 'publish', etag: approved.etag }, author);
    assert.equal((await getBlogEntry(id))?.published, true);
    const saved = await updateBlogPost(id, input, published.etag, author.userDetails);
    assert.equal((await getBlogEntry(id))?.workflow.state, 'draft');
    assert.deepEqual((await GetBlogEndpoint()).jsonBody, []);
    const again = await transitionBlog(id, { action: 'submit', etag: saved }, author);
    const reapproved = await transitionBlog(id, { action: 'approve', etag: again.etag }, reviewer);
    await saveBlogImages(id, [], reapproved.etag, author.userDetails);
    assert.equal((await getBlogEntry(id))?.workflow.state, 'draft');
    await assert.rejects(transitionBlog(id, { action: 'publish', etag: reapproved.etag }, author));
  }
);
