export const prerender = true;

export function GET() {
  const siteUrl = Astro.site ?? new URL('https://dev.stamm-phoenix.de');
  const sitemapUrl = new URL('/sitemap.xml', siteUrl).href;

  const body = [
    'User-agent: *',
    'Allow: /',
    `Sitemap: ${sitemapUrl}`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
