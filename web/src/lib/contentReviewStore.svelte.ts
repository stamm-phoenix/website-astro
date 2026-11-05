import { createResource } from './pflegeStore.svelte';
import type { ContentReviewItem } from '../../../api/lib/content-review-model';
export const contentReviews = createResource<ContentReviewItem[]>('/intern/pflege/content-review', {
  loadError: 'Die Redaktionsübersicht konnte nicht geladen werden. Versuche es erneut.',
});
