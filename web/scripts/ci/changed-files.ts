/** Reads the files a pull request changes, for the CI scripts that map them to work. */
import { spawnSync } from 'node:child_process';

export interface ChangedFiles {
  files?: string[];
  error?: string;
}

/** Paths changed between `base` and `HEAD`, relative to `root` (the repository root). */
export function readChangedFiles(root: string, base: string): ChangedFiles {
  const diff = spawnSync('git', ['diff', '--name-only', '--no-renames', base, 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (diff.status !== 0) return { error: `git diff failed: ${(diff.stderr ?? '').trim()}` };
  return { files: diff.stdout.split('\n').filter(Boolean) };
}
