import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { listTestFiles, shardFiles, usesDatabase } from "./test-shard.mjs";

const realDir = fileURLToPath(new URL("../../test", import.meta.url));

function allShards(dir, count) {
  return Array.from({ length: count }, (_, i) => shardFiles(dir, i + 1, count));
}

test("shards are disjoint and together equal the full list", () => {
  const full = listTestFiles(realDir);
  for (const count of [1, 2, 3, 5]) {
    const all = allShards(realDir, count).flat();
    assert.equal(new Set(all).size, all.length, `disjoint for ${count}`);
    assert.deepEqual([...all].sort(), full);
  }
});

test("database test files are spread evenly", () => {
  const counts = allShards(realDir, 3).map((files) => files.filter((f) => usesDatabase(realDir, f)).length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, counts.join(","));
});

test("a file added later is picked up without a list", () => {
  const dir = mkdtempSync(join(tmpdir(), "shard-"));
  try {
    for (const name of ["a.test.ts", "b.test.ts", "c.test.ts"]) writeFileSync(join(dir, name), "");
    writeFileSync(join(dir, "d.test.ts"), 'import "./fixtures/database";');
    writeFileSync(join(dir, "helper.ts"), "");
    const before = allShards(dir, 2).flat().sort();
    assert.deepEqual(before, ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts"]);
    writeFileSync(join(dir, "e.test.ts"), 'import { dbTest } from "./fixtures/database";');
    assert.deepEqual(allShards(dir, 2).flat().sort(), [...before, "e.test.ts"]);
    // the two database files land in different shards
    assert.deepEqual(
      allShards(dir, 2).map((files) => files.filter((f) => usesDatabase(dir, f))),
      [["d.test.ts"], ["e.test.ts"]],
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("invalid shard numbers are refused", () => {
  assert.throws(() => shardFiles(realDir, 0, 3));
  assert.throws(() => shardFiles(realDir, 4, 3));
});
