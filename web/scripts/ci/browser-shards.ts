export interface TestGroup {
  project: string;
  file: string;
  seconds: number;
}

/** Whole project/file groups keep the mock server's sequential tests together. */
export function balanceGroups(groups: TestGroup[], count: number): TestGroup[][] {
  if (!Number.isInteger(count) || count < 1) throw new Error('Invalid shard count');
  const shards: TestGroup[][] = Array.from({ length: count }, () => []);
  const totals = Array.from({ length: count }, () => 0);
  const ordered = [...groups].sort(
    (a, b) =>
      b.seconds - a.seconds || `${a.project}/${a.file}`.localeCompare(`${b.project}/${b.file}`)
  );
  for (const group of ordered) {
    const index = totals.indexOf(Math.min(...totals));
    shards[index].push(group);
    totals[index] += group.seconds;
  }
  return shards;
}
