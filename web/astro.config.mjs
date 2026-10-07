// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import bakedContent from './integrations/bakedContent';

// Baked dates and times are rendered like in the browser of our visitors
process.env.TZ ??= 'Europe/Berlin';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  // Browser tests and review captures should not run the development toolbar's audits.
  devToolbar: { enabled: process.env.MOCK_API !== '1' },
  // Fixed production address, also in previews: canonical links and the sitemap must point to the live site
  site: 'https://www.stamm-phoenix.de',
  integrations: [
    {
      name: 'local-mock-api',
      hooks: {
        'astro:server:setup': async ({ server }) => {
          // Loaded only by `dev:mock`; production builds never include demo endpoints.
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
        // Live view of posts without a page of their own, see 404.astro
        !page.includes('/blog/beitrag'),
    }),
    bakedContent(),
    svelte(),
  ],
  vite: {
    // Chrome 94+, Safari 15.4+, Firefox 93+: no down-leveling or polyfills for older engines.
    build: { target: 'es2022' },
    cacheDir:
      process.env.MOCK_API === '1'
        ? `node_modules/.vite-mock${process.env.VITE_CACHE_SUFFIX ?? ''}`
        : undefined,
    plugins: [tailwindcss()],
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
});
