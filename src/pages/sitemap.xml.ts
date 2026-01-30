import aktionenData from '../data/aktionen.json';
import { normalizeEvents } from '../lib/events';

export const prerender = true;

const STATIC_ROUTES = ['/', '/aktionen', '/gruppenstunden', '/kontakt', '/mitmachen', '/impressum'];

export function GET() {
  const siteUrl = Astro.site ?? new URL('https://dev.stamm-phoenix.de');
  const base = siteUrl.href.endsWith('/') ? siteUrl.href.slice(0, -1) : siteUrl.href;
  const lastmod = new Date().toISOString();

  const eventUrls = normalizeEvents(aktionenData).map((event) => `${base}/aktionen/${event.uid}`);
  const urls = [...new Set([...STATIC_ROUTES.map((path) => `${base}${path}`), ...eventUrls])];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (url) => `  <url>
    <loc>${url}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
  </url>`
    )
    .join('\n')}\n</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
