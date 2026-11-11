/**
 * Selects the browser specs of a run once and prints the jobs as a GitHub Actions matrix
 * (`browser-matrix.ts`). Used by the job `select` of `.github/workflows/browser-tests.yml`.
 *
 * `bun scripts/ci/select-browser-shards.ts` writes `matrix=<json>` and `run=<true|false>` to
 * `$GITHUB_OUTPUT`. With `E2E_AFFECTED_BASE` set (pull requests), only the specs the change can
 * affect run; anything that cannot be mapped selects everything, see affected-specs.ts.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import process from 'node:process';
import { browserMatrix, parseDurations, withDurations } from './browser-matrix';

interface DiscoverySuite {
  file?: string;
  suites?: DiscoverySuite[];
  specs?: { tests: { projectName: string }[] }[];
}

const PROJECTS = ['desktop', 'mobile', 'webkit-tablet'];
const discovery = spawnSync(
  'bunx',
  [
    'playwright',
    'test',
    '--list',
    ...PROJECTS.map((project) => `--project=${project}`),
    '--reporter=json',
  ],
  {
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf8',
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: '' },
  }
);
if (discovery.status !== 0) throw new Error(discovery.stderr || 'Test discovery failed');
const report = JSON.parse(discovery.stdout) as { suites: DiscoverySuite[] };

const found = new Map<string, { project: string; file: string }>();
function visit(suite: DiscoverySuite): void {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      if (!suite.file) throw new Error('Missing discovered test file');
      const file = relative(resolve('tests'), resolve('tests', suite.file));
      found.set(`${test.projectName}/${file}`, { project: test.projectName, file });
    }
  }
  for (const child of suite.suites ?? []) visit(child);
}
report.suites.forEach(visit);
if (found.size === 0) throw new Error('No test groups discovered');

let candidates = [...found.values()];
const base = process.env.E2E_AFFECTED_BASE;
if (base) {
  const [answer, reason] = (
    spawnSync('bun', ['scripts/ci/select-affected.ts', base], { encoding: 'utf8' }).stdout ?? ''
  )
    .trim()
    .split('\t');
  if (answer && answer !== 'all') {
    const wanted = new Set(answer.split(','));
    candidates = candidates.filter((group) => wanted.has(group.file));
    console.log(`Affected specs: ${wanted.size} files (${reason})`);
  } else {
    console.log(`Whole suite: ${reason ?? 'no answer from select-affected'}`);
  }
} else {
  console.log('Whole suite: no base given');
}

// Measured in run 42920295941 on main; a new project/file uses the median known duration
const durations = parseDurations(
  readFileSync(new URL('./browser-durations.tsv', import.meta.url), 'utf8')
);
const matrix = browserMatrix(withDurations(candidates, durations));
for (const job of matrix.include) {
  const files = job.tests.split('\n').length;
  console.log(`${job.browser} ${job.name}: ${files} project/files, about ${job.seconds} s summed`);
}
if (matrix.include.length === 0) console.log('No browser specs to run.');
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `matrix=${JSON.stringify(matrix)}\nrun=${matrix.include.length > 0}\n`
  );
}
