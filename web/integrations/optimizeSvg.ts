import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { optimize } from 'svgo';

/** The SVG without comments, metadata and needless precision; the drawing stays the same. */
export function optimizeSvg(source: string): string {
  return optimize(source, { multipass: true }).data;
}

function findSvgs(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const file = path.join(directory, name);
    if (statSync(file).isDirectory()) return findSvgs(file);
    return name.endsWith('.svg') ? [file] : [];
  });
}

/**
 * Shrinks every SVG of the site with SVGO at build time, so nobody has to run it by hand and the
 * sources in `src/` and `public/` stay as they were drawn: SVGs imported as text (the inline
 * logo in header and footer) when they are loaded, all others in the finished build.
 */
export default function optimizeSvgs(): AstroIntegration {
  return {
    name: 'optimize-svg',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'optimize-svg-raw',
                enforce: 'pre',
                load(id) {
                  if (!id.endsWith('.svg?raw')) return null;
                  const file = id.slice(0, -'?raw'.length);
                  return `export default ${JSON.stringify(optimizeSvg(readFileSync(file, 'utf8')))}`;
                },
              },
            ],
          },
        });
      },
      'astro:build:done': ({ dir, logger }) => {
        let before = 0;
        let after = 0;
        for (const file of findSvgs(fileURLToPath(dir))) {
          const source = readFileSync(file, 'utf8');
          const optimized = optimizeSvg(source);
          before += Buffer.byteLength(source);
          if (Buffer.byteLength(optimized) < Buffer.byteLength(source)) {
            writeFileSync(file, optimized);
            after += Buffer.byteLength(optimized);
          } else {
            after += Buffer.byteLength(source);
          }
        }
        logger.info(`SVGs: ${before} -> ${after} bytes`);
      },
    },
  };
}
