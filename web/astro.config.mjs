// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import bakedContent from './integrations/bakedContent';

// Baked dates and times are rendered like in the browser of our visitors
process.env.TZ ??= 'Europe/Berlin';

// UI variants of Issue #97: always in the dev server, in builds only for PR previews (UI_PREVIEW=1)
const uiPreviewBuild = process.env.UI_PREVIEW === '1';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  // Fixed production address, also in previews: canonical links and the sitemap must point to the live site
  site: 'https://stamm-phoenix.de',
  integrations: [
    {
      name: 'dev-preview',
      hooks: {
        'astro:config:setup': ({ command, injectRoute }) => {
          // Overview of the UI variants (Issue #97), dev server and PR previews only
          if (command === 'dev' || uiPreviewBuild) {
            injectRoute({
              pattern: '/ui-vorschau',
              entrypoint: fileURLToPath(
                new URL('./dev/ui-varianten/UiVorschau.astro', import.meta.url)
              ),
            });
          }
        },
        'astro:build:done': async ({ dir }) => {
          if (!uiPreviewBuild) return;
          // The comparison view embeds pages of the same site in iframes
          const configUrl = new URL('staticwebapp.config.json', dir);
          const config = JSON.parse(await readFile(configUrl, 'utf8'));
          config.globalHeaders['X-Frame-Options'] = 'SAMEORIGIN';
          await writeFile(configUrl, JSON.stringify(config, null, 2));
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
      name: 'staff-detail-routes',
      hooks: {
        'astro:server:setup': ({ server }) => {
          // Mirror Azure's authenticated detail-page rewrite during local development.
          server.middlewares.use((request, _response, next) => {
            const url = new URL(request.url ?? '/', 'http://localhost');
            if (/^\/leitendenbereich\/sammelbestellungen\/\d+\/?$/.test(url.pathname)) {
              request.url = `/leitendenbereich/sammelbestellungen/detail${url.search}`;
            }
            if (/^\/leitendenbereich\/abrechnung\/evt_[A-Za-z0-9]+\/?$/.test(url.pathname)) {
              request.url = `/leitendenbereich/abrechnung/detail${url.search}`;
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
        // Only forwards old links to /blog/<id>/
        !page.includes('/blog/beitrag') &&
        !page.includes('/ui-vorschau'),
    }),
    bakedContent(),
    svelte(),
  ],
  vite: {
    cacheDir: process.env.MOCK_API === '1' ? 'node_modules/.vite-mock' : undefined,
    define: {
      'import.meta.env.UI_PREVIEW': JSON.stringify(uiPreviewBuild),
    },
    plugins: [tailwindcss()],
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
});
