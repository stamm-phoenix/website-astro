import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { BUILD_INFO } from '../src/lib/buildInfo';
import { getContentSource } from '../src/lib/content/source';
import { STAGED_IMAGES_DIR, readStagedSources, resetStaging } from '../src/lib/content/staging';
import {
  CONTENT_SOURCE_NAMES,
  type ContentVersion,
  combineHashes,
} from '../src/lib/content/version';

const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

/**
 * Puts the content baked by `src/lib/content/` into the site: the images go to `/baked/`, and
 * `/content-version.json` records which data the build contains (see `version.ts`).
 */
export default function bakedContent(): AstroIntegration {
  return {
    name: 'baked-content',
    hooks: {
      'astro:build:start': () => {
        resetStaging();
      },
      'astro:server:setup': ({ server }) => {
        resetStaging();
        server.middlewares.use((request, response, next) => {
          const url = new URL(request.url ?? '/', 'http://localhost');
          const match = /^\/baked\/([\w-]+\.[a-z]+)$/.exec(url.pathname);
          const file = match && path.join(STAGED_IMAGES_DIR, match[1]);
          if (!file || !existsSync(file)) {
            next();
            return;
          }
          response.setHeader(
            'Content-Type',
            CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream'
          );
          response.end(readFileSync(file));
        });
      },
      'astro:build:done': ({ dir, logger }) => {
        const outDir = fileURLToPath(dir);
        if (existsSync(STAGED_IMAGES_DIR)) {
          mkdirSync(path.join(outDir, 'baked'), { recursive: true });
          cpSync(STAGED_IMAGES_DIR, path.join(outDir, 'baked'), { recursive: true });
        }

        const staged = readStagedSources();
        const sources = Object.fromEntries(
          CONTENT_SOURCE_NAMES.map((name) => [name, staged[name]?.ok ? 'ok' : 'missing'])
        ) as ContentVersion['sources'];
        const version: ContentVersion = {
          hash: combineHashes(
            Object.fromEntries(CONTENT_SOURCE_NAMES.map((name) => [name, staged[name]?.hash]))
          ),
          sources,
          source: getContentSource(),
          builtAt: new Date().toISOString(),
          commit: BUILD_INFO.commit,
        };
        writeFileSync(path.join(outDir, 'content-version.json'), JSON.stringify(version, null, 2));

        const missing = CONTENT_SOURCE_NAMES.filter((name) => sources[name] === 'missing');
        logger.info(
          `Baked content from "${version.source}"` +
            (missing.length > 0 ? `; not baked: ${missing.join(', ')}` : '')
        );
      },
    },
  };
}
