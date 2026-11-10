/**
 * Prints the specs a pull request affects, or `all`. Used by `select-browser-shard.ts`.
 *
 * `bun scripts/ci/select-affected.ts <base>` compares the checkout with `<base>` (in CI the first
 * parent of the merge commit, `HEAD^1`). Without a base, or when the diff cannot be read, it prints
 * `all`: a wrong guess must never skip tests.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { selectAffected } from './affected-specs';

const base = process.argv[2];
const root = resolve('..');
if (!base) {
  console.log('all\tno base given');
  process.exit(0);
}
const diff = spawnSync('git', ['diff', '--name-only', '--no-renames', base, 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});
if (diff.status !== 0) {
  console.log(`all\tgit diff failed: ${diff.stderr.trim()}`);
  process.exit(0);
}
const changed = diff.stdout.split('\n').filter(Boolean);
const selection = selectAffected({ root, changed });
if (selection.mode === 'all') console.log(`all\t${selection.reason}`);
else console.log(`${selection.specs.join(',')}\t${selection.reason}`);
