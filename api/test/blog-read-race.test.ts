import * as imageStorage from '../lib/blog-images';
import { mock } from 'node:test';
import * as database from '../lib/db';
import assert from 'node:assert/strict';
import { HttpRequest } from '@azure/functions';
import type { KyselyPlugin, QueryId, RootOperationNode } from 'kysely';
import { dbTest } from './fixtures/database';
import { getDb } from '../lib/db';
import { addBlogImage, createBlogPost } from '../lib/blog-list';
import { GetBlogEndpoint, GetBlogPostEndpoint, GetBlogImageEndpoint } from '../endpoints/blog';

// Pause after SQL has returned the parent row, before the former image read.
// Start a real image transaction on another connection. Without retained parent
// locks it commits here and leaks the new cover/image through the old status.
for (const kind of ['list', 'post', 'image'] as const) {
  dbTest(`public ${kind} cannot mix published status with a concurrent draft image`, async () => {
    const { id } = await createBlogPost(
      { title: 'Race', date: '2026-11-05', content: '<p>Public</p>', published: false },
      'author'
    );
    await getDb()
      .updateTable('content.blog_post')
      .set({ published: true, workflow_json: null })
      .where('id', '=', Number(id))
      .execute();
    const base = getDb();
    let parentQuery: QueryId | undefined;
    let writer: Promise<unknown> | undefined;
    let intercepted = false;
    const plugin: KyselyPlugin = {
      transformQuery(args) {
        const node = args.node as RootOperationNode;
        if (
          !intercepted &&
          node.kind === 'SelectQueryNode' &&
          JSON.stringify(node).includes('blog_post')
        )
          parentQuery = args.queryId;
        return node;
      },
      async transformResult(args) {
        if (!intercepted && args.queryId === parentQuery) {
          intercepted = true;
          writer = addBlogImage(
            id,
            { file: 'bild-999.jpg', alt: 'Private draft', width: 800, height: 600 },
            undefined,
            'author'
          );
          // A broken reader lets the writer finish before it reads images. A
          // correct reader blocks it until its own transaction has completed.
          await Promise.race([writer, new Promise((resolve) => setTimeout(resolve, 250))]);
        }
        return args.result;
      },
    };
    // Plugins are inherited by transactions and observe real executed SQL.
    const patched = mock.method(database, 'getDb', () => base.withPlugin(plugin));
    const blob = mock.method(imageStorage, 'serveBlogImage', async () => ({
      status: 200,
      body: 'PRIVATE DRAFT',
    }));
    try {
      const request = new HttpRequest({
        url: 'https://example.test/api/blog',
        method: 'GET',
        params: { id, file: 'bild-999.jpg' },
      });
      const response = await (kind === 'list'
        ? GetBlogEndpoint()
        : kind === 'post'
          ? GetBlogPostEndpoint(request)
          : GetBlogImageEndpoint(request));
      assert.equal(intercepted, true);
      assert.ok(!String(JSON.stringify(response.jsonBody)).includes('bild-999.jpg'));
      assert.ok(!String(JSON.stringify(response.jsonBody)).includes('Private draft'));
      if (kind === 'image') assert.equal(response.status, 404);
    } finally {
      await writer;
      patched.mock.restore();
      blob.mock.restore();
    }
  });
}
