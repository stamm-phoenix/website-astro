/**
 * E2E budget: fails when a pull request adds Playwright tests or spec files, unless it carries
 * the label `e2e-ok`. The rule is in AGENTS.md ("Welche Testebene?").
 *
 * Usage in CI (from `web/`): `bun scripts/ci/e2e-budget.ts <base> <head> (in CI: HEAD^1 HEAD, the merge commit and its base)`; the label is
 * read from `PR_LABELS` (JSON array of label names). Only git objects are read, so it also works
 * for pull requests from forks and needs no secrets.
 */
import { execFileSync } from 'node:child_process';

export const E2E_OK_LABEL = 'e2e-ok';
const SPEC_DIR = 'web/tests/';
const SPEC_PATTERN = /\.spec\.ts$/;
// `test(` and `test.only(` at the start of a line, and `test.skip/fixme/fail('title', …)` with a
// literal title. Conditional `test.skip(cond, …)`, `test.slow()`, `test.describe`, `test.step`,
// `test.use` and hooks are not tests. Loops that generate tests count once.
const TEST_PATTERN = /^\s*(?:test(?:\.only)?\s*\(|test\.(?:skip|fixme|fail)\s*\(\s*['"`])/;

export interface Budget {
  specFiles: number;
  tests: number;
}

export interface BudgetResult {
  ok: boolean;
  messages: string[];
}

export function countTests(source: string): number {
  return source.split('\n').filter((line) => TEST_PATTERN.test(line)).length;
}

export function isSpecPath(path: string): boolean {
  return path.startsWith(SPEC_DIR) && SPEC_PATTERN.test(path);
}

export function evaluateBudget(base: Budget, head: Budget, labels: string[]): BudgetResult {
  const newFiles = Math.max(0, head.specFiles - base.specFiles);
  const newTests = Math.max(0, head.tests - base.tests);
  if (newFiles === 0 && newTests === 0) {
    return { ok: true, messages: ['Keine neuen E2E-Tests oder Spec-Dateien.'] };
  }
  const added = `Dieser PR fügt ${newTests} E2E-Test(s) und ${newFiles} Spec-Datei(en) hinzu (jetzt ${head.tests} Tests in ${head.specFiles} Dateien, vorher ${base.tests} in ${base.specFiles}).`;
  if (labels.includes(E2E_OK_LABEL)) {
    return { ok: true, messages: [added, `Freigegeben durch das Label „${E2E_OK_LABEL}“.`] };
  }
  return {
    ok: false,
    messages: [
      added,
      'Logik, Validierung und Konflikte gehören in `bun test`. Ein neuer E2E-Test ist nur für einen neuen Nutzerablauf oder Browser-Verhalten gedacht, höchstens einer pro PR, am besten in einer bestehenden Spec.',
      `Begründe ihn in der PR-Beschreibung und setze das Label „${E2E_OK_LABEL}“, sonst bleibt dieser Check rot.`,
    ],
  };
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function budgetAt(sha: string): Budget {
  const files = git('ls-tree', '-r', '--name-only', '--full-tree', sha, '--', SPEC_DIR)
    .split('\n')
    .filter(isSpecPath);
  const tests = files.reduce((sum, file) => sum + countTests(git('show', `${sha}:${file}`)), 0);
  return { specFiles: files.length, tests };
}

function main(): void {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error(
      'Aufruf: bun scripts/ci/e2e-budget.ts <base> <head> (in CI: HEAD^1 HEAD, the merge commit and its base)'
    );
    process.exit(2);
  }
  const labels: unknown = JSON.parse(process.env.PR_LABELS ?? '[]');
  const names = Array.isArray(labels)
    ? labels.filter((l): l is string => typeof l === 'string')
    : [];
  const result = evaluateBudget(budgetAt(base), budgetAt(head), names);
  for (const message of result.messages) console.log(message);
  if (!result.ok) {
    console.log(
      `::error::${result.messages[0]} Label „${E2E_OK_LABEL}“ oder Test auf Unit-Ebene verlagern.`
    );
    process.exit(1);
  }
}

if (import.meta.main) main();
