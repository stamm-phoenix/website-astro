import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ContentReviewItem } from '../../api/lib/content-review-model';
const kinds = ['blog', 'faq', 'gruppenstunde', 'leitende', 'aktion', 'download'] as const;
const titles = [
  'Sommerlager am See',
  'Was kostet die Mitgliedschaft?',
  'Wölflinge',
  'Alex Beispiel',
  'Stammeswochenende',
  'Packliste Sommerlager.pdf',
];
const items: ContentReviewItem[] = kinds.map((kind, index) => ({
  kind,
  id: String(index + 1),
  title: titles[index],
  updatedAt: '2026-10-01T12:00:00Z',
  updatedBy: 'Alex Beispiel',
  reviewedAt:
    index % 3 === 0 ? null : index % 3 === 1 ? '2026-01-10T09:00:00Z' : '2026-10-05T09:00:00Z',
  reviewedBy: index % 3 === 0 ? null : 'Sam Muster',
  changedSinceReview: false,
  etag: `"000000000000000${index + 1}"`,
  campflowOwned: kind === 'aktion',
}));
export async function mockContentReview(
  req: IncomingMessage,
  res: ServerResponse,
  path: string
): Promise<boolean> {
  if (!path.startsWith('/api/intern/pflege/content-review')) return false;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && path === '/api/intern/pflege/content-review') {
    res.end(JSON.stringify(items));
    return true;
  }
  const item = items.find(
    (item) => path === `/api/intern/pflege/content-review/${item.kind}/${item.id}`
  );
  if (req.method !== 'POST' || !item) {
    res.statusCode = 404;
    res.end('{}');
    return true;
  }
  let body = '';
  for await (const chunk of req) body += String(chunk);
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== 'object' || !('etag' in parsed) || parsed.etag !== item.etag) {
    res.statusCode = 409;
    res.end(JSON.stringify({ message: 'Der Eintrag wurde geändert. Lade die Übersicht neu.' }));
    return true;
  }
  item.reviewedAt = new Date().toISOString();
  item.reviewedBy = 'Du (Testdaten)';
  item.changedSinceReview = false;
  res.end(JSON.stringify(item));
  return true;
}
