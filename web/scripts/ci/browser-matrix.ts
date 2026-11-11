/**
 * The jobs of the browser tests for a selection of specs, as the `include` list of a GitHub
 * Actions matrix. Used by `select-browser-shards.ts` in the job `select` of
 * `.github/workflows/browser-tests.yml`, which runs once per workflow run.
 *
 * Chromium (projects `desktop` and `mobile`) gets as few shards as keep the estimated wall time
 * of each at about `TARGET_SECONDS` (`browser-shards.ts`), WebKit (`webkit-tablet`) one job,
 * and only when one of its specs is selected.
 */
import { balanceGroups, estimateWallSeconds, totalSeconds } from './browser-shards';
import type { TestGroup } from './browser-shards';

/**
 * Estimated seconds from the first to the last test of a Chromium shard. A shard job spends
 * about 60 s besides the tests (container, install, build, report), so 85 s keeps a job at about
 * 2:30 min (#570).
 */
export const TARGET_SECONDS = 85;
export const MAX_SHARDS = 16;
const WEBKIT_PROJECT = 'webkit-tablet';
export const CHROMIUM_WORKERS = 6;

export interface BrowserJob {
  /** Shown in the job name, e.g. `1/3` or `WebKit` */
  name: string;
  browser: 'chromium' | 'webkit';
  /** Concurrency key, stable across runs: a newer run cancels the same shard of an older one */
  group: string;
  /** Arguments for `playwright test` */
  args: string;
  workers: number;
  /** Lines of the `--test-list` file, `[project] > file` */
  tests: string;
  /** Summed seconds of the specs */
  seconds: number;
  /** Estimated seconds from the first to the last test, see `estimateWallSeconds` */
  wall: number;
}

export interface BrowserMatrix {
  include: BrowserJob[];
}

/** Durations from `browser-durations.tsv` (`project<TAB>file<TAB>seconds`), keyed `project/file`. */
export function parseDurations(text: string): Map<string, number> {
  return new Map(
    text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line): [string, number] => {
        const [project, file, seconds] = line.split('\t');
        return [`${project}/${file}`, Number(seconds)];
      })
  );
}

/**
 * Test counts from the optional fourth column of `browser-durations.tsv`, as measured; the
 * discovery of the run counts the tests anew and takes precedence.
 */
export function parseTestCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of text.split('\n')) {
    const [project, file, , tests] = line.split('\t');
    if (tests !== undefined && Number(tests) >= 1) counts.set(`${project}/${file}`, Number(tests));
  }
  return counts;
}

/** The median known duration, used for a project/file without one; 30 s when none is known. */
export function fallbackSeconds(durations: Map<string, number>): number {
  const sorted = [...durations.values()].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 30;
}

/** Adds the known or the fallback duration to each discovered project/file. */
export function withDurations(
  found: readonly { project: string; file: string; tests?: number }[],
  durations: Map<string, number>,
  counts: Map<string, number> = new Map()
): TestGroup[] {
  const fallback = fallbackSeconds(durations);
  return found.map(({ project, file, tests }) => {
    const known = tests ?? counts.get(`${project}/${file}`);
    return {
      project,
      file,
      seconds: durations.get(`${project}/${file}`) ?? fallback,
      ...(known === undefined ? {} : { tests: known }),
    };
  });
}

function fits(shards: readonly TestGroup[][]): boolean {
  return shards.every((shard) => estimateWallSeconds(shard, CHROMIUM_WORKERS) <= TARGET_SECONDS);
}

/**
 * The fewest Chromium shards (1 to `MAX_SHARDS`, never more than files) whose estimated wall
 * time each stays within `TARGET_SECONDS`; `MAX_SHARDS` when no count does.
 */
export function chromiumShards(groups: readonly TestGroup[]): TestGroup[][] {
  if (groups.length === 0) return [];
  const most = Math.min(MAX_SHARDS, groups.length);
  // Fewer shards than the summed work allows can never fit; start there
  let count = Math.min(
    most,
    Math.max(1, Math.ceil(totalSeconds(groups) / (CHROMIUM_WORKERS * TARGET_SECONDS)))
  );
  let shards = balanceGroups(groups, count);
  while (!fits(shards) && count < most) {
    count += 1;
    shards = balanceGroups(groups, count);
  }
  return shards.filter((s) => s.length > 0);
}

const sum = totalSeconds;
const testList = (groups: readonly TestGroup[]): string =>
  groups.map((g) => `[${g.project}] > ${g.file}`).join('\n');

/** The matrix for the selected project/files; an empty selection gives no job. */
export function browserMatrix(groups: readonly TestGroup[]): BrowserMatrix {
  const webkit = groups.filter((g) => g.project === WEBKIT_PROJECT);
  const chromium = groups.filter((g) => g.project !== WEBKIT_PROJECT);
  const include: BrowserJob[] = [];
  if (chromium.length > 0) {
    const shards = chromiumShards(chromium);
    shards.forEach((shard, index) => {
      include.push({
        name: `${index + 1}/${shards.length}`,
        browser: 'chromium',
        group: `chromium-${index + 1}`,
        args: '--project=desktop --project=mobile --test-list=test-results/shard.txt',
        workers: CHROMIUM_WORKERS,
        tests: testList(shard),
        seconds: Math.round(sum(shard)),
        wall: Math.round(estimateWallSeconds(shard, CHROMIUM_WORKERS)),
      });
    });
  }
  if (webkit.length > 0) {
    // The small WebKit suite runs with one worker and one dev server
    include.push({
      name: 'WebKit',
      browser: 'webkit',
      group: 'webkit',
      args: `--project=${WEBKIT_PROJECT} --test-list=test-results/shard.txt`,
      workers: 1,
      tests: testList([...webkit].sort((a, b) => a.file.localeCompare(b.file))),
      seconds: Math.round(sum(webkit)),
      wall: Math.round(estimateWallSeconds(webkit, 1)),
    });
  }
  return { include };
}
