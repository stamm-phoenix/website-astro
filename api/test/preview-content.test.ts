import assert from 'node:assert/strict';
import * as blobStorage from '../lib/blob-storage';
import { deleteBlogPost, getBlogEntries, removeBlogImage } from '../lib/blog-list';
import { sql } from 'kysely';
import { getDb } from '../lib/db';
import { seedPreviewBlog, seedPreviewQuestions, seedPreviewSammel } from '../lib/db-preview';
import * as env from '../lib/environment';
import { getSammelCampaigns, getSammelOrders } from '../lib/sammelbestellung-list';
import { deleteQuestionAndAnswer, getStaffQuestionsAndAnswers } from '../lib/qa-list';
import { dbTest } from './fixtures/database';

dbTest('preview content is seeded once and a later run only fills what is missing', async (t) => {
  const blobs = new Map<string, Buffer>();
  t.mock.method(blobStorage, 'putBlob', async (name: string, bytes: Uint8Array) => {
    blobs.set(name, Buffer.from(bytes));
  });

  await seedPreviewQuestions();
  await seedPreviewBlog();
  const questions = await getStaffQuestionsAndAnswers();
  const posts = await getBlogEntries();
  assert.equal(questions.length, 4);
  assert.equal(posts.length, 3);
  const withImages = posts.find((post) => post.images.length > 0);
  assert.ok(withImages);
  assert.equal(withImages.images.length, 2);
  assert.match(withImages.content, /data-bild="bild-\d+\.jpg"/);
  assert.equal(blobs.size, 4);

  // As if an earlier run had stopped halfway
  await deleteQuestionAndAnswer(questions[1].id, questions[1].etag);
  const draft = posts.find((post) => !post.published);
  assert.ok(draft);
  await deleteBlogPost(draft.id, draft.etag);
  await removeBlogImage(withImages.id, withImages.images[0].file, undefined, 'test');

  await seedPreviewQuestions();
  await seedPreviewBlog();
  assert.deepEqual(
    (await getStaffQuestionsAndAnswers()).map((entry) => entry.question).sort(),
    questions.map((entry) => entry.question).sort()
  );
  const refilled = await getBlogEntries();
  assert.deepEqual(
    refilled.map((post) => post.title).sort(),
    posts.map((post) => post.title).sort()
  );
  const again = refilled.find((post) => post.id === withImages.id);
  assert.deepEqual(
    again?.images.map((image) => image.file).sort(),
    withImages.images.map((image) => image.file).sort()
  );
});

dbTest('preview Sammelbestellungen fill every table once and stay readable', async (t) => {
  t.mock.method(env, 'getEnvironment', () => 'test-secret-with-more-than-thirty-two-characters');
  await seedPreviewSammel();
  const count = async (table: string): Promise<number> =>
    Number(
      (
        await sql<{ count: number }>`SELECT COUNT(*) AS count FROM ${sql.table(table)}`.execute(
          getDb()
        )
      ).rows[0].count
    );
  const tables = [
    'sammel.campaign',
    'sammel.catalog_item',
    'sammel.catalog_variant',
    'sammel.invitation',
    'sammel.link_quota',
    'sammel.member_order',
    'sammel.order_item',
    'sammel.payment',
    'sammel.payment_email',
    'sammel.payment_event',
  ] as const;
  const first = await Promise.all(tables.map(count));
  assert.ok(
    first.every((value) => value > 0),
    JSON.stringify(first)
  );
  await seedPreviewSammel();
  assert.deepEqual(await Promise.all(tables.map(count)), first);
  const campaigns = await getSammelCampaigns();
  assert.deepEqual(
    campaigns.map((campaign) => campaign.archived),
    [false, true]
  );
  const orders = await getSammelOrders(campaigns[0].id);
  assert.deepEqual(
    orders.map((order) => order.status),
    ['Eingereicht', 'Eingereicht', 'Bestellt', 'Bestellt', 'Storniert']
  );
  assert.equal(orders.find((order) => order.payment)?.payment?.state, 'created');
});
