import { getCampflowEvents } from './campflow';
import type { ContentReviewItem } from './content-review-model';

export interface ReviewWithCampflow extends ContentReviewItem {
  campflowId: string | null;
}

/** Display-only overlay: never called while holding a review's database write locks. */
export async function resolveReviewTitles(
  items: ReviewWithCampflow[],
  loadEvents: () => Promise<readonly { id: string; title: string }[]> = getCampflowEvents
): Promise<ContentReviewItem[]> {
  let titles = new Map<string, string>();
  if (items.some((item) => item.campflowId !== null)) {
    try {
      titles = new Map((await loadEvents()).map((event) => [event.id, event.title.trim()]));
    } catch {
      // An unavailable external source must not hide the website's stored content.
    }
  }
  return items.map(({ campflowId, ...item }) => ({
    ...item,
    title: (campflowId && titles.get(campflowId)) || item.title,
  }));
}
