/**
 * The jobs of the browser tests for a selection of specs, as the `include` list of a GitHub
 * Actions matrix. Used by `select-browser-shards.ts` in the job `select` of
 * `.github/workflows/browser-tests.yml`, which runs once per workflow run.
 *
 * Chromium (projects `desktop` and `mobile`) gets as many shards as the summed durations need,
 * WebKit (`webkit-tablet`) one job, and only when one of its specs is selected.
 */
import { balanceGroups } from './browser-shards';
import type { TestGroup } from './browser-shards';

/**
 * Summed spec seconds per Chromium shard. In the full run 42920295941 on main, a shard with
 * 561 summed seconds took 253 s in its test step (four workers, one server each), so about
 * 360 summed seconds give the target of about three minutes of test time per shard.
 */
export const SHARD_SECONDS = 360;
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
  /** Estimated summed seconds of the specs */
  seconds: number;
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

/** Chromium shards for the summed seconds: about `SHARD_SECONDS` each, 1 to `MAX_SHARDS`. */
export function shardCount(seconds: number): number {
  return Math.min(MAX_SHARDS, Math.max(1, Math.ceil(seconds / SHARD_SECONDS)));
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
    const shards = balanceGroups(chromium, shardCount(sum(chromium))).filter((s) => s.length > 0);
    shards.forEach((shard, index) => {
      include.push({
        name: `${index + 1}/${shards.length}`,
        browser: 'chromium',
        group: `chromium-${index + 1}`,
        args: '--project=desktop --project=mobile --test-list=test-results/shard.txt',
        workers: CHROMIUM_WORKERS,
        tests: testList(shard),
        seconds: Math.round(sum(shard)),
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
    });
  }
  return { include };
}
