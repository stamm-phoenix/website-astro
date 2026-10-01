// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  // Fixed production address, also in previews: canonical links and the sitemap must point to the live site
  site: 'https://stamm-phoenix.de',
  integrations: [
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
