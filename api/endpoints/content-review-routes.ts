import { app } from '@azure/functions';
import { getContentReviews, isReviewKind, markContentReviewed } from '../lib/content-review';
import { NOT_FOUND, ok } from '../lib/pflege-api';
import { readJsonBody } from '../lib/response-utils';
import { validateContentReview } from '../lib/validation/content-review';
import { staffHandler } from '../lib/handler';

export const ContentReviewCollection = staffHandler('content-review', async () => {
  return ok(await getContentReviews());
});
export const ContentReviewItem = staffHandler(
  'content-review',
  async (request, _context, principal) => {
    const { kind = '', id = '' } = request.params;
    if (!isReviewKind(kind) || !id || id.length > 128 || (kind !== 'download' && !/^\d+$/.test(id)))
      return NOT_FOUND;
    const { etag } = validateContentReview(await readJsonBody(request));
    return ok(await markContentReviewed(kind, id, etag, principal.userDetails));
  }
);
app.http('contentReviewCollection', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'intern/pflege/content-review',
  handler: ContentReviewCollection,
});
app.http('contentReviewItem', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/content-review/{kind}/{id}',
  handler: ContentReviewItem,
});
