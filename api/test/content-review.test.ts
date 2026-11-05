import { seedPreviewContentReviews } from '../lib/db-preview-content-review';
import { deleteDownloadRow } from '../lib/download-delete';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { ContentReviewCollection, ContentReviewItem } from '../endpoints/content-review-routes';
import assert from 'node:assert/strict';
import test from 'node:test';
import { getDb, requireVersion, RecordNotFoundError, VersionConflictError } from '../lib/db';
import { getContentReviews, markContentReviewed } from '../lib/content-review';
import { validateContentReview } from '../lib/validation/content-review';
import { ValidationError } from '../lib/validation/errors';
import { dbTest } from './fixtures/database';

test('review validator requires a loaded version and ignores spoofed identity/time', () => {
  const etag = '"0000000000000001"';
  assert.deepEqual(validateContentReview({ etag, reviewedBy: 'spoof', reviewedAt: '2099-01-01' }), {
    etag,
  });
  for (const value of [{}, { etag: 'bad' }, { etag: 2 }]) {
    assert.throws(
      () => validateContentReview(value),
      (error: unknown) =>
        error instanceof ValidationError &&
        error.fields.etag === 'Lade den Eintrag vor dem Prüfen neu.'
    );
  }
});

dbTest(
  'review preserves content audit, rejects stale edits and deletes, and follows later changes',
  async () => {
    const db = getDb();
    const row = await db
      .insertInto('content.faq')
      .values({
        question: 'Review test',
        answer: '<p>Test</p>',
        category: 'Test',
        published: true,
        updated_by: 'editor@example.test',
      })
      .output('inserted.id')
      .executeTakeFirstOrThrow();
    const find = async () =>
      (await getContentReviews()).find(
        (item) => item.kind === 'faq' && item.id === String(row.id)
      )!;
    const initial = await find();
    assert.equal(initial.reviewedAt, null);
    const reviewed = await markContentReviewed(
      'faq',
      initial.id,
      initial.etag,
      'reviewer@example.test'
    );
    assert.equal(reviewed.etag, initial.etag);
    assert.equal(reviewed.updatedAt, initial.updatedAt);
    assert.equal(reviewed.updatedBy, 'editor@example.test');
    assert.equal(reviewed.reviewedBy, 'reviewer@example.test');
    assert.equal(reviewed.changedSinceReview, false);
    assert.ok(reviewed.reviewedAt);
    const repeated = await markContentReviewed(
      'faq',
      initial.id,
      initial.etag,
      'other@example.test'
    );
    assert.equal(repeated.etag, initial.etag);
    assert.equal(repeated.reviewedBy, 'other@example.test');
    await db
      .updateTable('content.faq')
      .set({ question: 'Changed', updated_at: new Date(Date.now() + 1000) })
      .where('id', '=', row.id)
      .execute();
    assert.equal((await find()).changedSinceReview, true);
    await assert.rejects(
      markContentReviewed('faq', initial.id, reviewed.etag, 'other'),
      VersionConflictError
    );
    await db.deleteFrom('content.faq').where('id', '=', row.id).execute();
    assert.equal(await find(), undefined);
    assert.equal(
      await db
        .selectFrom('content.review')
        .select('content_id')
        .where('kind', '=', 'faq')
        .where('content_id', '=', initial.id)
        .executeTakeFirst(),
      undefined
    );
    await assert.rejects(
      markContentReviewed('faq', initial.id, reviewed.etag, 'other'),
      RecordNotFoundError
    );
  }
);

test('review endpoints refuse anonymous requests before reading or writing content', async () => {
  const context = new InvocationContext({ functionName: 'contentReview' });
  const collection = await ContentReviewCollection(
    new HttpRequest({
      method: 'GET',
      url: 'https://example.test/api/intern/pflege/content-review',
    }),
    context
  );
  const item = await ContentReviewItem(
    new HttpRequest({
      method: 'POST',
      url: 'https://example.test/api/intern/pflege/content-review/faq/1',
      params: { kind: 'faq', id: '1' },
      body: { string: '{"etag":"\\"0000000000000001\\""}' },
    }),
    context
  );
  assert.equal(collection.status, 401);
  assert.equal(item.status, 401);
});

dbTest(
  'all six domains expose existing audit data and accept reviews with cascading cleanup',
  async () => {
    const db = getDb();
    await db
      .insertInto('content.blog_post')
      .values({
        title: 'Blog',
        post_date: '2026-11-01',
        content: '<p>Test</p>',
        published: true,
        updated_by: 'blog-editor',
      })
      .execute();
    await db
      .insertInto('content.faq')
      .values({
        question: 'FAQ',
        answer: '<p>Test</p>',
        category: 'Test',
        published: true,
        updated_by: 'faq-editor',
      })
      .execute();
    await db
      .insertInto('content.gruppenstunde')
      .values({
        id: 90001,
        stufe: 'Wölflinge',
        weekday: 'Montag',
        meeting_time: '17:00',
        age_range: '7–10',
        location: 'Heim',
        description: '<p>Test</p>',
        updated_by: 'gruppenstunde-editor',
      })
      .execute();
    await db
      .insertInto('content.leitende')
      .values({ id: 90001, name: 'Alex', photo: null, updated_by: 'leitende-editor' })
      .execute();
    await db
      .insertInto('content.aktion')
      .values({
        id: 90001,
        title: 'CampFlow Aktion',
        start_date: null,
        end_date: null,
        campflow_id: 'test-event',
        updated_by: 'aktion-editor',
      })
      .execute();
    await db
      .insertInto('content.download')
      .values({
        id: 'review-test-download',
        file_name: 'Review.pdf',
        file_key: 'review-test',
        size: 10,
        mime_type: 'application/pdf',
        updated_by: 'download-editor',
      })
      .execute();
    await seedPreviewContentReviews();
    const seeded = await getContentReviews();
    await seedPreviewContentReviews();
    const items = await getContentReviews();
    assert.deepEqual(items, seeded);
    assert.equal(items.length, 6);
    assert.ok(items.every((item) => item.reviewedBy === 'Redaktion (Testdaten)'));
    for (const item of items) {
      assert.equal(item.updatedBy, `${item.kind}-editor`);
      assert.equal(item.campflowOwned, item.kind === 'aktion');
      const reviewed = await markContentReviewed(
        item.kind,
        item.id,
        item.etag,
        'reviewer@example.test'
      );
      assert.equal(reviewed.reviewedBy, 'reviewer@example.test');
      assert.equal(reviewed.etag, item.etag);
    }
    await db
      .deleteFrom('content.download')
      .where('id', '=', 'review-test-download')
      .output('deleted.file_key')
      .execute();
    assert.equal((await getContentReviews()).length, 5);
    assert.equal(
      await db
        .selectFrom('content.review')
        .select('content_id')
        .where('kind', '=', 'download')
        .executeTakeFirst(),
      undefined
    );
  }
);

dbTest('deleting a linked download invalidates action review and stale etag', async () => {
  const db = getDb();
  await db
    .insertInto('content.aktion')
    .values({
      id: 90002,
      title: 'Linked action',
      start_date: null,
      end_date: null,
      updated_by: 'original-editor',
    })
    .execute();
  await db
    .insertInto('content.download')
    .values({
      id: 'review-linked-download',
      file_name: 'Linked.pdf',
      file_key: 'review-linked',
      size: 10,
      mime_type: 'application/pdf',
      updated_by: 'uploader',
    })
    .execute();
  await db
    .insertInto('content.aktion_download')
    .values({
      aktion_id: 90002,
      download_id: 'review-linked-download',
      sort_order: 0,
    })
    .execute();
  const items = await getContentReviews();
  const action = items.find((item) => item.kind === 'aktion')!;
  const download = items.find((item) => item.kind === 'download')!;
  await markContentReviewed('aktion', action.id, action.etag, 'reviewer');
  await deleteDownloadRow(download.id, requireVersion(download.etag), 'actual-deleter');
  const changed = (await getContentReviews()).find((item) => item.kind === 'aktion')!;
  assert.equal(changed.changedSinceReview, true);
  assert.equal(changed.updatedBy, 'actual-deleter');
  assert.notEqual(changed.etag, action.etag);
  await assert.rejects(
    markContentReviewed('aktion', action.id, action.etag, 'reviewer'),
    VersionConflictError
  );
});
