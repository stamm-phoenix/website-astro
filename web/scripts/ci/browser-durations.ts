/**
 * Writes `browser-durations.tsv` from the Playwright reports of full runs: per project/file the
 * mean seconds over the runs and the number of tests, `project<TAB>file<TAB>seconds<TAB>tests`.
 * A file's seconds are the summed last attempts of its tests; skipped tests count no time.
 *
 * Download the reports of each run into a folder of its own, e.g.
 *   gh run download <run> -p 'browser-report-*' -D runs/<run>
 * and then, in `web/`:
 *   bun scripts/ci/browser-durations.ts runs/<run1> runs/<run2> runs/<run3> > scripts/ci/browser-durations.tsv
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface ReportResult {
  status: string;
  duration: number;
}

export interface ReportSuite {
  file?: string;
  suites?: ReportSuite[];
  specs?: { file: string; tests: { projectName: string; results: ReportResult[] }[] }[];
}

/** Seconds and test count per `project<TAB>file` of one run (all its shard reports). */
export function runDurations(
  reports: readonly { suites: ReportSuite[] }[]
): Map<string, { seconds: number; tests: number }> {
  const files = new Map<string, { seconds: number; tests: number }>();
  const visit = (suite: ReportSuite): void => {
    for (const child of suite.suites ?? []) visit(child);
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const key = `${test.projectName}\t${spec.file}`;
        const last = test.results.at(-1);
        const entry = files.get(key) ?? { seconds: 0, tests: 0 };
        entry.tests += 1;
        if (last && last.status !== 'skipped') entry.seconds += last.duration / 1000;
        files.set(key, entry);
      }
    }
  };
  for (const report of reports) report.suites.forEach(visit);
  return files;
}

/** The lines of the TSV, sorted, with the mean seconds over the runs that have the file. */
export function durationLines(
  runs: readonly Map<string, { seconds: number; tests: number }>[]
): string[] {
  const keys = [...new Set(runs.flatMap((run) => [...run.keys()]))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return keys.map((key) => {
    const seen = runs.map((run) => run.get(key)).filter((entry) => entry !== undefined);
    const seconds = seen.reduce((n, entry) => n + entry.seconds, 0) / seen.length;
    const tests = Math.max(...seen.map((entry) => entry.tests));
    return `${key}\t${seconds.toFixed(1)}\t${tests}`;
  });
}

/** Every `results.json` below a folder. */
function reportsIn(folder: string): { suites: ReportSuite[] }[] {
  const found: { suites: ReportSuite[] }[] = [];
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) found.push(...reportsIn(path));
    else if (name === 'results.json') found.push(JSON.parse(readFileSync(path, 'utf8')));
  }
  return found;
}

if (import.meta.main) {
  const folders = process.argv.slice(2);
  if (folders.length === 0) {
    console.error('Usage: bun scripts/ci/browser-durations.ts <run folder>...');
    process.exit(1);
  }
  console.log(durationLines(folders.map((folder) => runDurations(reportsIn(folder)))).join('\n'));
}
