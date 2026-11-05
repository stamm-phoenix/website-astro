import { app } from '@azure/functions';
import { getContentReviews, isReviewKind, markContentReviewed } from '../lib/content-review';
import { METHOD_NOT_ALLOWED, NOT_FOUND, ok, pflegeHandler, readJsonBody } from '../lib/pflege-api';
import { withErrorHandling } from '../lib/response-utils';
import { validateContentReview } from '../lib/validation/content-review';

export const ContentReviewCollection = withErrorHandling(
  pflegeHandler('content-review', async (request) => {
    if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
    return ok(await getContentReviews());
  })
);
export const ContentReviewItem = withErrorHandling(
  pflegeHandler('content-review', async (request, _context, principal) => {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
    const { kind = '', id = '' } = request.params;
    if (!isReviewKind(kind) || !id || id.length > 128 || (kind !== 'download' && !/^\d+$/.test(id)))
      return NOT_FOUND;
    const { etag } = validateContentReview(await readJsonBody(request));
    return ok(await markContentReviewed(kind, id, etag, principal.userDetails));
  })
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
