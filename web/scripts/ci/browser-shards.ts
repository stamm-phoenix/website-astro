/**
 * Splits browser specs into shards by their estimated wall time.
 *
 * Within a shard Playwright does not follow the order of `--test-list`: it runs the files project
 * by project (in the order of playwright.config.ts) and by name, each file on the next free
 * worker, its tests one after the other. A long file whose name sorts late therefore starts only
 * when a worker is free and can end far after the others (run 42947457925: `staff-app.spec.ts`
 * started after 54 s and ended the shard at 251 s). The estimate replays that order.
 */
export interface TestGroup {
  project: string;
  file: string;
  seconds: number;
}

/** Project order of playwright.config.ts; unknown projects follow by name. */
const PROJECT_ORDER = ['desktop', 'mobile', 'webkit-tablet'];

function projectRank(project: string): number {
  const index = PROJECT_ORDER.indexOf(project);
  return index === -1 ? PROJECT_ORDER.length : index;
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The order in which Playwright starts the project/files of a shard. */
export function playwrightOrder(groups: readonly TestGroup[]): TestGroup[] {
  return [...groups].sort(
    (a, b) =>
      projectRank(a.project) - projectRank(b.project) ||
      byName(a.project, b.project) ||
      byName(a.file, b.file)
  );
}

/** Estimated seconds until the last file of the shard ends, with `workers` parallel workers. */
export function estimateWallSeconds(groups: readonly TestGroup[], workers: number): number {
  if (!Number.isInteger(workers) || workers < 1) throw new Error('Invalid worker count');
  const free = Array.from({ length: workers }, () => 0);
  for (const group of playwrightOrder(groups)) {
    const index = free.indexOf(Math.min(...free));
    free[index] += group.seconds;
  }
  return Math.max(...free);
}

const sum = (groups: readonly TestGroup[]): number => groups.reduce((n, g) => n + g.seconds, 0);
const key = (g: TestGroup): string => `${g.project}/${g.file}`;

/** A shard may take `target` seconds, or as long as its longest file, since a file never splits. */
export function shardLimit(groups: readonly TestGroup[], target: number): number {
  return Math.max(target, ...groups.map((g) => g.seconds));
}

interface Placement {
  index: number;
  fits: boolean;
  wall: number;
  growth: number;
  work: number;
}

/** Fitting first, then the lower wall time if nothing fits, the least growth, the least work. */
function better(a: Placement, b: Placement): boolean {
  if (a.fits !== b.fits) return a.fits;
  if (!a.fits && a.wall !== b.wall) return a.wall < b.wall;
  if (a.growth !== b.growth) return a.growth < b.growth;
  if (a.work !== b.work) return a.work < b.work;
  return a.index < b.index;
}

/**
 * Whole project/file groups keep the mock server's sequential tests together. The longest files
 * are placed first, each into a shard that stays within its limit (`shardLimit`) and whose
 * estimated wall time grows least, so a short file fills an idle worker next to a long one; ties
 * go to the shard with less work. A file that fits nowhere goes where the wall time stays lowest.
 */
export function balanceGroups(
  groups: readonly TestGroup[],
  count: number,
  workers: number,
  target: number
): TestGroup[][] {
  if (!Number.isInteger(count) || count < 1) throw new Error('Invalid shard count');
  const shards: TestGroup[][] = Array.from({ length: count }, () => []);
  const walls = Array.from({ length: count }, () => 0);
  const ordered = [...groups].sort((a, b) => b.seconds - a.seconds || byName(key(a), key(b)));
  for (const group of ordered) {
    const chosen = shards
      .map((shard, index): Placement => {
        const next = [...shard, group];
        const wall = estimateWallSeconds(next, workers);
        return {
          index,
          fits: wall <= shardLimit(next, target),
          wall,
          growth: wall - walls[index],
          work: sum(shard),
        };
      })
      .reduce((best, placement) => (better(placement, best) ? placement : best));
    shards[chosen.index].push(group);
    walls[chosen.index] = chosen.wall;
  }
  return shards;
}
