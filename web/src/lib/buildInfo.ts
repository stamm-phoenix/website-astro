import { execSync } from 'node:child_process';
import type { BuildInfo } from './types';

const REPO_URL = 'https://github.com/stamm-phoenix/website-astro';

function resolveCommit(): string | null {
  const fromEnv = process.env.BUILD_COMMIT_SHA?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

const commit = resolveCommit();

export const BUILD_INFO: BuildInfo = {
  commit,
  shortCommit: commit ? commit.slice(0, 7) : null,
  commitUrl: commit ? `${REPO_URL}/commit/${commit}` : null,
  builtAt: new Date().toISOString(),
};
