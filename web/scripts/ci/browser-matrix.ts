/**
 * The jobs of the browser tests for a selection of specs, as the `include` list of a GitHub
 * Actions matrix. Used by `select-browser-shards.ts` in the job `select` of
 * `.github/workflows/browser-tests.yml`, which runs once per workflow run.
 *
 * Chromium (projects `desktop` and `mobile`) gets as few shards as keep the estimated wall time
 * of each at about `TARGET_SECONDS` (`browser-shards.ts`), WebKit (`webkit-tablet`) one job,
 * and only when one of its specs is selected.
 */
import { balanceGroups, estimateWallSeconds, shardLimit } from './browser-shards';
import type { TestGroup } from './browser-shards';

/**
 * Estimated seconds from the first to the last test of a Chromium shard. Start of the dev
 * servers and warm-up add 24 to 43 s to the test step, and the estimate was at most 22 s below
 * the real time (run 42947457925), so a shard stays below about 3:40 min. A shard whose longest
 * file takes longer may take as long as that file, since a file never splits.
 */
export const TARGET_SECONDS = 150;
export const MAX_SHARDS = 12;
const WEBKIT_PROJECT = 'webkit-tablet';
const CHROMIUM_WORKERS = 4;

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

/** The median known duration, used for a project/file without one; 30 s when none is known. */
export function fallbackSeconds(durations: Map<string, number>): number {
  const sorted = [...durations.values()].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 30;
}

/** Adds the known or the fallback duration to each discovered project/file. */
export function withDurations(
  found: readonly { project: string; file: string }[],
  durations: Map<string, number>
): TestGroup[] {
  const fallback = fallbackSeconds(durations);
  return found.map(({ project, file }) => ({
    project,
    file,
    seconds: durations.get(`${project}/${file}`) ?? fallback,
  }));
}

/** Lowers the target in these steps while the shard count still fits, to even out the shards. */
const EVEN_OUT_STEP = 5;

function fits(shards: readonly TestGroup[][], target: number): boolean {
  return shards.every(
    (shard) => estimateWallSeconds(shard, CHROMIUM_WORKERS) <= shardLimit(shard, target)
  );
}

/**
 * The fewest Chromium shards (1 to `MAX_SHARDS`, never more than files) that each stay within
 * `TARGET_SECONDS` or their longest file; `MAX_SHARDS` when no count does. With that count the
 * target is then lowered as far as everything still fits, so the work spreads evenly instead of
 * filling the first shards and leaving a small last one.
 */
export function chromiumShards(groups: readonly TestGroup[]): TestGroup[][] {
  if (groups.length === 0) return [];
  const most = Math.min(MAX_SHARDS, groups.length);
  let count = 1;
  let shards = balanceGroups(groups, count, CHROMIUM_WORKERS, TARGET_SECONDS);
  while (!fits(shards, TARGET_SECONDS) && count < most) {
    count += 1;
    shards = balanceGroups(groups, count, CHROMIUM_WORKERS, TARGET_SECONDS);
  }
  if (fits(shards, TARGET_SECONDS)) {
    for (let target = TARGET_SECONDS - EVEN_OUT_STEP; target > 0; target -= EVEN_OUT_STEP) {
      const lower = balanceGroups(groups, count, CHROMIUM_WORKERS, target);
      if (!fits(lower, target)) break;
      shards = lower;
    }
  }
  return shards.filter((s) => s.length > 0);
}

const sum = (groups: readonly TestGroup[]): number => groups.reduce((n, g) => n + g.seconds, 0);
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
