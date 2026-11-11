/**
 * Splits browser specs into shards by their estimated wall time.
 *
 * Against the built site every test starts with fresh demo data and Playwright runs fully
 * parallel (#570): within a shard it takes the tests project by project (in the order of
 * playwright.config.ts), file by file by name and in the order of each file, and gives each to the
 * next free worker. A long file therefore spreads over all workers instead of holding one. The
 * estimate replays that order with each file split into its tests of equal length; the durations
 * are known per file only (`browser-durations.tsv`).
 */
export interface TestGroup {
  project: string;
  file: string;
  seconds: number;
  /** Number of tests of the file in the project; 1 when unknown */
  tests?: number;
}

/** Project order of playwright.config.ts; unknown projects follow by name. */
const PROJECT_ORDER = ['desktop', 'mobile', 'webkit-tablet'];

function projectRank(project: string): number {
  const index = PROJECT_ORDER.indexOf(project);
  return index === -1 ? PROJECT_ORDER.length : index;
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The order in which Playwright takes the project/files of a shard. */
export function playwrightOrder(groups: readonly TestGroup[]): TestGroup[] {
  return [...groups].sort(
    (a, b) =>
      projectRank(a.project) - projectRank(b.project) ||
      byName(a.project, b.project) ||
      byName(a.file, b.file)
  );
}

/** The seconds of each test in Playwright's order, a file split evenly into its tests. */
export function testSeconds(groups: readonly TestGroup[]): number[] {
  return playwrightOrder(groups).flatMap((group) => {
    const tests = Math.max(1, Math.round(group.tests ?? 1));
    return Array.from({ length: tests }, () => group.seconds / tests);
  });
}

/** Estimated seconds until the last test of the shard ends, with `workers` parallel workers. */
export function estimateWallSeconds(groups: readonly TestGroup[], workers: number): number {
  if (!Number.isInteger(workers) || workers < 1) throw new Error('Invalid worker count');
  const free = Array.from({ length: workers }, () => 0);
  for (const seconds of testSeconds(groups)) {
    const index = free.indexOf(Math.min(...free));
    free[index] += seconds;
  }
  return Math.max(...free);
}

const sum = (groups: readonly TestGroup[]): number => groups.reduce((n, g) => n + g.seconds, 0);
const key = (g: TestGroup): string => `${g.project}/${g.file}`;

/**
 * Splits the groups into `count` shards: the longest files first, each into the shard with the
 * least summed work (ties to the lower index). Since the tests of a file spread over the workers,
 * equal work gives about equal wall time.
 */
export function balanceGroups(groups: readonly TestGroup[], count: number): TestGroup[][] {
  if (!Number.isInteger(count) || count < 1) throw new Error('Invalid shard count');
  const shards: TestGroup[][] = Array.from({ length: count }, () => []);
  const work = Array.from({ length: count }, () => 0);
  const ordered = [...groups].sort((a, b) => b.seconds - a.seconds || byName(key(a), key(b)));
  for (const group of ordered) {
    const index = work.indexOf(Math.min(...work));
    shards[index].push(group);
    work[index] += group.seconds;
  }
  return shards;
}

/** Summed seconds of the groups. */
export function totalSeconds(groups: readonly TestGroup[]): number {
  return sum(groups);
}
