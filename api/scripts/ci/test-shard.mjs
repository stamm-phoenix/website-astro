// Splits the API test files into shards for CI (#564).
// Usage: node scripts/ci/test-shard.mjs <shard 1..n> <n>   (run in api/)
// Prints the compiled test files (dist/test/*.test.js) of that shard, one per line.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DATABASE_FIXTURE = /fixtures\/database/;

/** Sorted test file names of a directory. */
export function listTestFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".test.ts"))
    .sort();
}

/** Test files that use the database fixture are slow, so they are spread separately. */
export function usesDatabase(dir, name) {
  return DATABASE_FIXTURE.test(readFileSync(join(dir, name), "utf8"));
}

/** Files of shard `index` (1-based) of `count`: round-robin over the sorted database and other files. */
export function shardFiles(dir, index, count) {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(index) || index < 1 || index > count) {
    throw new Error(`Invalid shard ${index}/${count}`);
  }
  const files = listTestFiles(dir);
  const database = files.filter((name) => usesDatabase(dir, name));
  const others = files.filter((name) => !database.includes(name));
  const pick = (list) => list.filter((_, position) => position % count === index - 1);
  return [...pick(database), ...pick(others)].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [index, count] = process.argv.slice(2).map(Number);
  const dir = fileURLToPath(new URL("../../test", import.meta.url));
  for (const name of shardFiles(dir, index, count)) {
    console.log(`dist/test/${name.replace(/\.ts$/, ".js")}`);
  }
}
