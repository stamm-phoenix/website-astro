import assert from 'node:assert/strict';
import { dbTest } from './fixtures/database';
import { getDb } from '../lib/db';
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
