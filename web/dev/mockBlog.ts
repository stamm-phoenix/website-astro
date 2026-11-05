import type { MockRequest, MockResult } from './mockApi';
import { nextBlogWorkflow } from '../../api/lib/blog-workflow-policy';
import type { BlogWorkflow } from '../../api/lib/blog-workflow-model';
import { blogEntries, blogUploads, staffBlogList, staffBlogPost } from './mock-data/content';
import { newId, newEtag, MOCK_NOW } from './mock-data/util';
const json = (body: unknown, status = 200): MockResult => ({ kind: 'json', body, status });
const error = (status: number, code: string, message: string): MockResult =>
  json({ error: code, code, message }, status);
const notFound = (message = 'Der Beitrag wurde nicht gefunden.'): MockResult =>
  error(404, 'NOT_FOUND', message);
const noContent = (): MockResult => ({ kind: 'empty', status: 204 });
const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const workflows = new Map<string, BlogWorkflow>();
const workflow = (id: string, published: boolean): BlogWorkflow =>
  workflows.get(id) ?? { state: published ? 'published' : 'draft' };
export function registerBlogRoutes(
  route: (
    methods: string | string[],
    path: string,
    handler: (req: MockRequest) => MockResult
  ) => void,
  blogImage: (id: string, file: string, width: string | null, published: boolean) => MockResult
): void {
  route(['GET', 'POST'], '/api/intern/pflege/blog', (req) => {
    if (req.method === 'GET')
      return json(
        staffBlogList().map((post) => ({ ...post, workflow: workflow(post.id, post.published) }))
      );
    const body = req.json ?? {};
    const id = newId();
    const entry = {
      id,
      etag: newEtag(`blog-${id}`),
      title: str(body.title),
      date: str(body.date, new Date(MOCK_NOW).toISOString().slice(0, 10)),
      published: false,
      content: str(body.content),
      images: [],
    };
    blogEntries.push(entry);
    return json({ id, etag: entry.etag }, 201);
  });

  route(['GET', 'PATCH', 'DELETE'], '/api/intern/pflege/blog/:id', (req) => {
    const index = blogEntries.findIndex((e) => e.id === req.params.id);
    if (index < 0) return notFound('Der Beitrag wurde nicht gefunden.');
    const entry = blogEntries[index];
    if (req.method === 'GET')
      return json({ ...staffBlogPost(entry), workflow: workflow(entry.id, entry.published) });
    if (req.method === 'DELETE') {
      blogEntries.splice(index, 1);
      return noContent();
    }
    const body = req.json ?? {};
    if (body.action) {
      if (body.etag !== entry.etag)
        return error(409, 'CONFLICT', 'Der Beitrag wurde inzwischen geändert. Bitte neu laden.');
      const rawPrincipal = req.headers['x-ms-client-principal'];
      const actor =
        typeof rawPrincipal === 'string'
          ? JSON.parse(Buffer.from(rawPrincipal, 'base64').toString())
          : { userId: 'demo-author', userDetails: 'Demo-Leitung' };
      try {
        const next = nextBlogWorkflow(
          workflow(entry.id, entry.published),
          body.action as 'submit',
          actor,
          'Demo-Leitung',
          str(body.feedback)
        );
        workflows.set(entry.id, next);
        entry.published = next.state === 'published';
        entry.etag = newEtag(entry.id);
        return json({ etag: entry.etag, workflow: next });
      } catch {
        return error(400, 'INVALID', 'Eine andere Person muss den Beitrag prüfen.');
      }
    }
    workflows.set(entry.id, { state: 'draft' });
    entry.title = str(body.title, entry.title);
    entry.date = str(body.date, entry.date);
    entry.published = false;
    entry.content = str(body.content, entry.content);
    entry.published = false;
    workflows.set(entry.id, { state: 'draft' });
    entry.etag = newEtag(`blog-${entry.id}`);
    return json({ etag: entry.etag });
  });

  /** Width and height from the SOF marker of a JPEG, if found. */
  function jpegSize(bytes: Buffer): { width: number; height: number } | null {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
    return null;
  }

  route(['PUT', 'PATCH'], '/api/intern/pflege/blog/:id/bilder', (req) => {
    const entry = blogEntries.find((e) => e.id === req.params.id);
    if (!entry) return notFound('Der Beitrag wurde nicht gefunden.');
    if (req.method === 'PATCH') {
      const raw = Array.isArray(req.json?.images) ? (req.json?.images as unknown[]) : [];
      const byFile = new Map(entry.images.map((i) => [i.file, i]));
      entry.images = raw.flatMap((value) => {
        const item = value as { file?: unknown; alt?: unknown };
        const image = byFile.get(str(item.file));
        return image ? [{ ...image, alt: str(item.alt, image.alt) }] : [];
      });
      entry.published = false;
      workflows.set(entry.id, { state: 'draft' });
      entry.etag = newEtag(`blog-${entry.id}`);
      return json({ etag: entry.etag, images: entry.images });
    }
    if (req.raw[0] !== 0xff || req.raw[1] !== 0xd8)
      return error(400, 'INVALID', 'Bitte ein Bild im JPEG-Format hochladen.');
    const size = jpegSize(req.raw) ?? { width: 1600, height: 1067 };
    const image = { file: `bild-${MOCK_NOW}.jpg`, alt: '', ...size };
    blogUploads.set(`${entry.id}/${image.file}`, new Uint8Array(req.raw));
    entry.images = [...entry.images, image];
    entry.published = false;
    workflows.set(entry.id, { state: 'draft' });
    entry.etag = newEtag(`blog-${entry.id}`);
    return json({ etag: entry.etag, images: entry.images, image }, 201);
  });

  route(['GET', 'DELETE'], '/api/intern/pflege/blog/:id/bilder/:file', (req) => {
    if (req.method === 'GET')
      return blogImage(req.params.id, req.params.file, req.query.get('w'), false);
    const entry = blogEntries.find((e) => e.id === req.params.id);
    if (!entry || !entry.images.some((i) => i.file === req.params.file)) return notFound();
    entry.images = entry.images.filter((i) => i.file !== req.params.file);
    blogUploads.delete(`${entry.id}/${req.params.file}`);
    entry.published = false;
    workflows.set(entry.id, { state: 'draft' });
    entry.etag = newEtag(`blog-${entry.id}`);
    return json({ etag: entry.etag, images: entry.images });
  });
}
