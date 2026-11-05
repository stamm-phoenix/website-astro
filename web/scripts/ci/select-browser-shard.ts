import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { balanceGroups } from './browser-shards';
import type { TestGroup } from './browser-shards';

interface DiscoverySuite {
  file?: string;
  suites?: DiscoverySuite[];
  specs?: { tests: { projectName: string }[] }[];
}
const [current, total] = (process.argv[2] ?? '').split('/').map(Number);
if (!Number.isInteger(current) || !Number.isInteger(total) || current < 1 || current > total) {
  throw new Error('Pass a shard such as 1/4');
}
const discovery = spawnSync(
  'bunx',
  ['playwright', 'test', '--list', '--project=desktop', '--project=mobile', '--reporter=json'],
  {
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf8',
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: '' },
  }
);
if (discovery.status !== 0) throw new Error(discovery.stderr || 'Test discovery failed');
const report = JSON.parse(discovery.stdout) as { suites: DiscoverySuite[] };
// Seeded from successful run 42089914938; new project/files use the median known duration.
const durations = new Map(
  readFileSync(new URL('./browser-durations.tsv', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line): [string, number] => {
      const [project, file, seconds] = line.split('\t');
      return [`${project}/${file}`, Number(seconds)];
    })
);
const sorted = [...durations.values()].sort((a, b) => a - b);
const fallback = sorted[Math.floor(sorted.length / 2)] ?? 30;
const groups = new Map<string, TestGroup>();
function visit(suite: DiscoverySuite): void {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      if (!suite.file) throw new Error('Missing discovered test file');
      const file = relative(resolve('tests'), resolve('tests', suite.file));
      const key = `${test.projectName}/${file}`;
      groups.set(key, { project: test.projectName, file, seconds: durations.get(key) ?? fallback });
    }
  }
  for (const child of suite.suites ?? []) visit(child);
}
report.suites.forEach(visit);
if (groups.size === 0) throw new Error('No test groups discovered');
const shards = balanceGroups([...groups.values()], total);
mkdirSync('test-results', { recursive: true });
writeFileSync(
  'test-results/shard.txt',
  shards[current - 1].map((g) => `[${g.project}] > ${g.file}`).join('\n') + '\n'
);
console.log(
  'Estimated seconds per shard:',
  shards.map((s) => Math.round(s.reduce((n, g) => n + g.seconds, 0)))
);
console.log(`Shard ${current}/${total}: ${shards[current - 1].length} project/files`);
