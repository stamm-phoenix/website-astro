import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ContentSourceName } from './version';

/**
 * Hand-over between the pages, which load and bake content while they are prerendered, and the
 * `baked-content` integration, which copies the result into `dist/` once the build is done.
 * A folder instead of module state, because Astro may prerender in a separate module graph.
 */

export const STAGING_DIR = path.resolve(process.cwd(), 'node_modules/.cache/baked-content');
export const STAGED_IMAGES_DIR = path.join(STAGING_DIR, 'images');
const SOURCES_DIR = path.join(STAGING_DIR, 'sources');

export interface StagedSource {
  ok: boolean;
  /** Hash of the raw response, see `version.ts` */
  hash?: string;
}

export function resetStaging(): void {
  rmSync(STAGING_DIR, { recursive: true, force: true });
  mkdirSync(STAGED_IMAGES_DIR, { recursive: true });
  mkdirSync(SOURCES_DIR, { recursive: true });
}

export function stageImage(fileName: string, body: Uint8Array): void {
  mkdirSync(STAGED_IMAGES_DIR, { recursive: true });
  writeFileSync(path.join(STAGED_IMAGES_DIR, fileName), body);
}

export function stageSource(name: ContentSourceName, source: StagedSource): void {
  mkdirSync(SOURCES_DIR, { recursive: true });
  writeFileSync(path.join(SOURCES_DIR, `${name}.json`), JSON.stringify(source));
}

export function readStagedSources(): Partial<Record<ContentSourceName, StagedSource>> {
  const sources: Partial<Record<ContentSourceName, StagedSource>> = {};
  let files: string[];
  try {
    files = readdirSync(SOURCES_DIR);
  } catch {
    return sources;
  }
  for (const file of files) {
    const name = path.basename(file, '.json') as ContentSourceName;
    sources[name] = JSON.parse(readFileSync(path.join(SOURCES_DIR, file), 'utf8')) as StagedSource;
  }
  return sources;
}
