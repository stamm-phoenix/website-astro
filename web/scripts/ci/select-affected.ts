/**
 * Prints the specs a pull request affects, or `all`. Used by `select-browser-shard.ts`.
 *
 * `bun scripts/ci/select-affected.ts <base>` compares the checkout with `<base>` (in CI the first
 * parent of the merge commit, `HEAD^1`). Without a base, or when the diff cannot be read, it prints
 * `all`: a wrong guess must never skip tests.
 */
import { resolve } from 'node:path';
import { selectAffected } from './affected-specs';
import { readChangedFiles } from './changed-files';

const base = process.argv[2];
const root = resolve('..');
if (!base) {
  console.log('all\tno base given');
  process.exit(0);
}
const { files: changed, error } = readChangedFiles(root, base);
if (!changed) {
  console.log(`all\t${error}`);
  process.exit(0);
}
const selection = selectAffected({ root, changed });
if (selection.mode === 'all') console.log(`all\t${selection.reason}`);
else console.log(`${selection.specs.join(',')}\t${selection.reason}`);
