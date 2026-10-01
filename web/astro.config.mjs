// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const siteUrl = process.env.SITE_URL ?? 'http://localhost:4321';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  site: siteUrl,
  integrations: [
    {
      name: 'dev-preview',
      hooks: {
        'astro:config:setup': ({ command, injectRoute }) => {
          // Overview of the UI variants (Issue #97), only in the dev server, never part of the build.
          if (command === 'dev') {
            injectRoute({
              pattern: '/ui-vorschau',
              entrypoint: fileURLToPath(
                new URL('./dev/ui-varianten/UiVorschau.astro', import.meta.url)
              ),
            });
          }
        },
        'astro:server:setup': async ({ server }) => {
          // `bun run dev:mock` serves test data for /api/* and /.auth/* instead of the real API.
          if (process.env.MOCK_API === '1') {
            const { mockApiMiddleware } = await server.ssrLoadModule('/dev/mockApi.ts');
            server.middlewares.use(mockApiMiddleware());
          }
        },
      },
    },
    {
      name: 'sammelbestellung-detail-routes',
      hooks: {
        'astro:server:setup': ({ server }) => {
          // Mirror Azure's authenticated detail-page rewrite during local development.
          server.middlewares.use((request, _response, next) => {
            const url = new URL(request.url ?? '/', 'http://localhost');
            if (/^\/leitendenbereich\/sammelbestellungen\/\d+\/?$/.test(url.pathname)) {
              request.url = `/leitendenbereich/sammelbestellungen/detail${url.search}`;
            }
            next();
          });
        },
      },
    },
    sitemap({
      filter: (page) =>
        !page.includes('/nikolaus/termin') &&
        !page.includes('/leitendenbereich') &&
        !page.includes('/mitgliederbereich') &&
        // Only reachable with ?id=; the posts themselves are loaded in the browser
        !page.includes('/blog/beitrag'),
    }),
    svelte(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
});
