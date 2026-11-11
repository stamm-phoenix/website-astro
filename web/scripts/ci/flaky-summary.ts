/**
 * Turns the Playwright JSON report of a test job into a Markdown list of failed and flaky tests
 * for `$GITHUB_STEP_SUMMARY` (step "List failed and flaky tests" in
 * `.github/workflows/browser-tests.yml`). Failed = failed in all attempts, flaky = passed after a
 * retry. Writes nothing when there is nothing to list or no report.
 * Run with `bun scripts/ci/flaky-summary.ts <report.json> [title]` in `web/`.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

interface Result {
  status: string;
}
interface Test {
  projectName?: string;
  status?: string;
  results?: Result[];
}
interface Spec {
  title: string;
  file: string;
  line: number;
  tests?: Test[];
}
interface Suite {
  specs?: Spec[];
  suites?: Suite[];
}
export interface Report {
  suites?: Suite[];
}

export interface ListedTest {
  file: string;
  line: number;
  title: string;
  project: string;
  attempts: number;
}

export interface TestLists {
  failed: ListedTest[];
  flaky: ListedTest[];
}

function collect(suites: Suite[] | undefined, lists: TestLists): void {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = (test.results ?? []).filter((result) => result.status !== 'skipped');
        if (results.length === 0) continue;
        const listed: ListedTest = {
          file: spec.file,
          line: spec.line,
          title: spec.title,
          project: test.projectName ?? '',
          attempts: results.length,
        };
        const last = results[results.length - 1].status;
        const passed = last === 'passed';
        if (!passed && results.every((result) => result.status !== 'passed')) {
          // interrupted runs are not a verdict of the test
          if (last !== 'interrupted') lists.failed.push(listed);
        } else if (passed && results.length > 1) {
          lists.flaky.push(listed);
        }
      }
    }
    collect(suite.suites, lists);
  }
}

export function listTests(report: Report): TestLists {
  const lists: TestLists = { failed: [], flaky: [] };
  collect(report.suites, lists);
  return lists;
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function table(heading: string, tests: ListedTest[]): string {
  const rows = tests.map(
    (test) =>
      `| \`${test.file}:${test.line}\` | ${cell(test.title)} | ${test.project} | ${test.attempts} |`
  );
  return [
    `### ${heading} (${tests.length})`,
    '',
    '| Datei | Test | Projekt | Versuche |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

/** Markdown for the summary; empty when no test failed or was flaky. */
export function renderSummary(lists: TestLists, title = 'Browser-Tests'): string {
  if (lists.failed.length === 0 && lists.flaky.length === 0) return '';
  const parts = [`## ${title}`, ''];
  if (lists.failed.length > 0) parts.push(table('Fehlgeschlagen', lists.failed));
  if (lists.flaky.length > 0)
    parts.push(table('Instabil (nach Wiederholung bestanden)', lists.flaky));
  return parts.join('\n');
}

if (import.meta.main) {
  const [path, title] = process.argv.slice(2);
  // A shard without tests, or a run that died before the report, has nothing to list
  if (path && existsSync(path)) {
    try {
      const text = renderSummary(
        listTests(JSON.parse(readFileSync(path, 'utf8')) as Report),
        title
      );
      if (text) {
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
        else console.log(text);
      }
    } catch (error: unknown) {
      console.warn(
        `The report could not be read: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
