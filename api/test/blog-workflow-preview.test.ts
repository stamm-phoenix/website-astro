import assert from 'node:assert/strict';
import { dbTest } from './fixtures/database';
import { getDb, toVersion } from '../lib/db';
import { transitionBlog } from '../lib/blog-workflow';
import { getBlogEntries } from '../lib/blog-list';
import { seedPreviewBlog } from '../lib/db-preview-blog';
import * as workflow from '../lib/blog-workflow-preview';
import * as blobs from '../lib/blob-storage';

dbTest('interrupted preview seeding recovers publication and preserves user edits', async (t) => {
  t.mock.method(blobs, 'putBlob', async () => undefined);
  const publish = workflow.seedBlogWorkflow;
  let interrupted = false;
  t.mock.method(workflow, 'seedBlogWorkflow', async (ids: number[]) => {
    if (!interrupted) {
      interrupted = true;
      throw new Error('Interrupted before publication');
    }
    await publish(ids);
  });
  await assert.rejects(seedPreviewBlog(), /Interrupted before publication/);
  const entries = await getBlogEntries();
  const edited = entries.find((entry) => entry.title === 'Testbeitrag: Waldweihnacht')!;
  await getDb()
    .updateTable('content.blog_post')
    .set({ updated_by: 'human' })
    .where('id', '=', Number(edited.id))
    .execute();
  await seedPreviewBlog();
  await seedPreviewBlog();
  const recovered = await getBlogEntries();
  assert.equal(
    recovered.find((entry) => entry.title === 'Testbeitrag: Sommerlager')?.published,
    true
  );
  assert.equal(recovered.find((entry) => entry.id === edited.id)?.published, false);
});

dbTest('preview seeding preserves an intentional withdrawal', async (t) => {
  t.mock.method(blobs, 'putBlob', async () => undefined);
  await seedPreviewBlog();
  const entry = (await getBlogEntries()).find((item) => item.title === 'Testbeitrag: Sommerlager')!;
  const row = await getDb()
    .selectFrom('content.blog_post')
    .selectAll()
    .where('id', '=', Number(entry.id))
    .executeTakeFirstOrThrow();
  await transitionBlog(
    entry.id,
    { action: 'unpublish', etag: toVersion(row.version) },
    {
      identityProvider: 'aad',
      userId: 'a',
      userDetails: 'a@example.test',
      userRoles: ['team_leitende'],
    }
  );
  await seedPreviewBlog();
  const result = await getDb()
    .selectFrom('content.blog_post')
    .selectAll()
    .where('id', '=', Number(entry.id))
    .executeTakeFirstOrThrow();
  assert.equal(result.published, false);
  assert.equal(result.updated_by, 'preview');
  assert.equal(JSON.parse(result.workflow_json!).withdrawn.by, 'a');
});
