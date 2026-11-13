/** Public content: map tiles, calendar files, Leitende, blog, downloads, Q&A and Instagram. */
import {
  blogEntries,
  blogUploads,
  buildIcs,
  calendarAktionen,
  downloads,
  instagramPosts,
  minimalPdf,
  publicAktionen,
  publicBlogList,
  publicBlogPost,
  publicDownloads,
  questions,
} from './mock-data/content';
import { stufeFeed } from './mock-data/aktionenFeeds';
import { leitende, leitendePhotos, publicLeitende, publicVorstand } from './mock-data/people';
import { avatarSvg, documentPreviewSvg, pickColor, sceneSvg, STUFE_COLORS } from './mock-data/svg';
import { error, jpeg, json, notFound, route, svg } from './mockCore';
import type { MockResult } from './mockCore';

// ---------------------------------------------------------------------------------------------
// Public content

route('GET', '/api/karte-quelle/:style/:z', () => json({ copyrights: ['©2026 TomTom'] }), true);

// Map tiles: a plain grid with the tile's coordinates instead of Azure Maps
route(
  'GET',
  '/api/karte/:style/:z/:x/:y',
  (req) => {
    const dark = req.params.style === 'dunkel';
    const label = `${req.params.z}/${req.params.x}/${req.params.y.replace(/\.png$/, '')}`;
    return svg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${dark ? '#1c2630' : '#eef1ea'}" stroke="${dark ? '#33414f' : '#cfd6cc'}"/><text x="8" y="20" font-family="sans-serif" font-size="11" fill="${dark ? '#8796a5' : '#7b8577'}">${label}</text></svg>`
    );
  },
  true
);

route(
  'GET',
  '/api/mock/campflow-embed',
  () => ({
    kind: 'raw',
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: `(() => {
      const script = document.currentScript;
      if (!script || script.parentElement.querySelector('iframe')) return;
      const frame = document.createElement('iframe');
      frame.title = 'Mitgliedsantrag';
      frame.style.cssText = 'width:100%;height:200px;border:0';
      frame.srcdoc = '<p>Demo-Mitgliedsantrag. Diese Eingaben werden nicht versendet.</p><form><label>Vorname <input name="firstName"></label><button type="button" disabled>Antrag senden (Demo)</button></form>';
      script.after(frame);
    })();`,
  }),
  true
);
route('GET', '/api/leitende', () => json(publicLeitende()));
route('GET', '/api/vorstand', () => json(publicVorstand()));
route('GET', '/api/aktionen', () => json(publicAktionen()));
route(
  'GET',
  '/api/aktionen.ics',
  () => ({
    kind: 'raw',
    status: 200,
    contentType: 'text/calendar; charset=utf-8',
    body: buildIcs(publicAktionen(), 'DPSG Stamm Phoenix - Aktionen'),
    headers: { 'Content-Disposition': 'attachment; filename="aktionen.ics"' },
  }),
  true
);
route(
  'GET',
  '/api/aktionen/:stufe.ics',
  (req) => {
    const feed = stufeFeed(req.params.stufe);
    if (!feed) return notFound('Diese Stufe gibt es nicht.');
    return {
      kind: 'raw',
      status: 200,
      contentType: 'text/calendar; charset=utf-8',
      body: feed.body,
      headers: { 'Content-Disposition': `attachment; filename="${feed.fileName}"` },
    };
  },
  true
);
route(
  'GET',
  '/api/leitende.ics',
  () => ({
    kind: 'raw',
    status: 200,
    contentType: 'text/calendar; charset=utf-8',
    body: buildIcs(
      calendarAktionen().filter((a) => a.stufen.length === 1 && a.stufen[0] === 'Leitende'),
      'DPSG Stamm Phoenix - Leitende'
    ),
    headers: { 'Content-Disposition': 'attachment; filename="leitende.ics"' },
  }),
  true
);

route(
  'GET',
  '/api/leitende/:id/image',
  (req) => {
    const person = leitende.find((p) => p.id === req.params.id);
    if (!person || !person.hasImage) return notFound();
    const photo = leitendePhotos.get(person.id);
    if (photo) return jpeg(photo);
    const team = person.teams.find((t) => STUFE_COLORS[t]) ?? '';
    return svg(avatarSvg(person.name, STUFE_COLORS[team] ?? pickColor(person.name)));
  },
  true
);

route('GET', '/api/blog', () => json(publicBlogList()));
route('GET', '/api/blog/:id', (req) => {
  const post = publicBlogPost(req.params.id);
  return post ? json(post) : notFound('Der Beitrag wurde nicht gefunden.');
});

export function blogImage(
  postId: string,
  file: string,
  requestedWidth: string | null,
  onlyPublished: boolean
): MockResult {
  const entry = blogEntries.find((e) => e.id === postId && (!onlyPublished || e.published));
  const image = entry?.images.find((i) => i.file === file);
  if (!entry || !image) return notFound();
  const upload = blogUploads.get(`${postId}/${file}`);
  if (upload) return jpeg(upload);
  const width = Math.min(Number(requestedWidth) || 800, image.width);
  const height = Math.max(1, Math.round((width * image.height) / image.width));
  return svg(sceneSvg(`${postId}-${file}`, width, height, image.alt || undefined));
}

route(
  'GET',
  '/api/blog/:id/bilder/:file',
  (req) => blogImage(req.params.id, req.params.file, req.query.get('w'), true),
  true
);

route('GET', '/api/downloads', () => json(publicDownloads()));
route(
  'GET',
  '/api/downloads/:id/image/:size',
  (req) => {
    const file = downloads.find((d) => d.id === req.params.id);
    if (!file?.hasPreview) return notFound();
    if (file.preview)
      return { kind: 'raw', status: 200, contentType: 'image/jpeg', body: file.preview };
    const width = req.params.size === 'large' ? 800 : req.params.size === 'medium' ? 400 : 200;
    return svg(
      file.mimeType.startsWith('image/')
        ? sceneSvg(file.id, width, Math.round(width * 0.75))
        : documentPreviewSvg(file.fileName, width, Math.round(width * 1.414))
    );
  },
  true
);
route(
  'GET',
  '/api/downloads/:id/file',
  (req) => {
    const file = downloads.find((d) => d.id === req.params.id);
    if (!file) return notFound();
    const isPdf = file.mimeType === 'application/pdf';
    return {
      kind: 'raw',
      status: 200,
      contentType: isPdf ? 'application/pdf' : 'text/plain; charset=utf-8',
      body: isPdf
        ? minimalPdf(file.fileName)
        : `Testdatei der Mock-API: ${file.fileName}\nIm echten Betrieb kommt hier die hochgeladene Datei.\n`,
      headers: {
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(
          isPdf ? file.fileName : `${file.fileName}.txt`
        )}`,
      },
    };
  },
  true
);

route('GET', '/api/qa', () =>
  json(
    questions
      .filter((q) => q.published)
      .map((q) => ({ id: q.id, question: q.question, answer: q.answer, category: q.category }))
  )
);

route('GET', '/api/instagram', () => json(instagramPosts));
route(
  'GET',
  '/api/instagram/:id/image',
  (req) => {
    const post = instagramPosts.find((p) => p.id === req.params.id);
    const index = Number(req.query.get('index') ?? '0');
    if (!post || !Number.isInteger(index) || index < 0 || index >= post.imageCount)
      return notFound();
    const size = req.query.get('size') === 'large' ? 1080 : 480;
    // Carousels alternate between square and portrait images, like real posts
    const height =
      post.mediaType === 'CAROUSEL_ALBUM' && index % 2 === 1 ? Math.round(size * 1.25) : size;
    return svg(sceneSvg(`ig-${post.id}-${index}`, size, height));
  },
  true
);
route(
  'GET',
  '/api/instagram/:id/video',
  () => error(404, 'NO_VIDEO', 'Im Mock-Modus gibt es keine Videos.'),
  true
);
