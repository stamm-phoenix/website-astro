/**
 * E2E budget: fails when a pull request adds Playwright tests or spec files, unless it carries
 * the label `e2e-ok`. The rule is in AGENTS.md ("Welche Testebene?"); how tests are counted is in
 * `e2e-test-count.ts`.
 *
 * Usage in CI (from `web/`): `bun scripts/ci/e2e-budget.ts HEAD^1 HEAD`, the merge commit of the
 * pull request and its base. The label comes from `PR_LABELS` (JSON array of label names). Only git
 * objects are read and nothing from the test files is executed, so it also works for fork pull
 * requests and needs no secrets.
 */
import { execFileSync } from 'node:child_process';
import { countRegistrations } from './e2e-test-count';

export const E2E_OK_LABEL = 'e2e-ok';
const TEST_DIR = 'web/tests/';
// Playwright's default testMatch
const SPEC_PATTERN = /\.(spec|test)\.[cm]?[jt]sx?$/;
// Helpers below web/tests/ can declare tests too, so every source file there is read.
const SOURCE_PATTERN = /\.[cm]?[jt]sx?$/;

export interface Budget {
  specFiles: number;
  /** Declared test cases (see e2e-test-count.ts), not runs after expanding loops. */
  tests: number;
  /** Declared cases inside loops or `.forEach/.map` callbacks. */
  loopedTests: number;
}

export interface BudgetResult {
  ok: boolean;
  messages: string[];
}

export function isSpecPath(path: string): boolean {
  return path.startsWith(TEST_DIR) && SPEC_PATTERN.test(path);
}

export function isTestSourcePath(path: string): boolean {
  return path.startsWith(TEST_DIR) && SOURCE_PATTERN.test(path);
}

export function evaluateBudget(base: Budget, head: Budget, labels: string[]): BudgetResult {
  const newFiles = Math.max(0, head.specFiles - base.specFiles);
  const newTests = Math.max(0, head.tests - base.tests);
  const newLooped = Math.max(0, head.loopedTests - base.loopedTests);
  if (newFiles === 0 && newTests === 0 && newLooped === 0) {
    return { ok: true, messages: ['Keine neuen E2E-Tests oder Spec-Dateien.'] };
  }
  const added = `Dieser PR fügt ${newTests} E2E-Test(s), davon ${newLooped} in Schleifen, und ${newFiles} Spec-Datei(en) hinzu (jetzt ${head.tests} Tests in ${head.specFiles} Dateien, vorher ${base.tests} in ${base.specFiles}).`;
  if (labels.includes(E2E_OK_LABEL)) {
    return { ok: true, messages: [added, `Freigegeben durch das Label „${E2E_OK_LABEL}“.`] };
  }
  return {
    ok: false,
    messages: [
      added,
      'Logik, Validierung und Konflikte gehören in `bun test`. Ein neuer E2E-Test ist nur für einen neuen Nutzerablauf oder Browser-Verhalten gedacht, höchstens einer pro PR, am besten in einer bestehenden Spec.',
      `Begründe ihn in der PR-Beschreibung. Das Label „${E2E_OK_LABEL}“ setzt nur Hugo oder eine maintainende Person nach dieser Prüfung, nicht der Autor oder ein Agent.`,
    ],
  };
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function budgetAt(rev: string): Budget {
  const files = git('ls-tree', '-r', '--name-only', '--full-tree', rev, '--', TEST_DIR)
    .split('\n')
    .filter(isTestSourcePath);
  const budget: Budget = { specFiles: 0, tests: 0, loopedTests: 0 };
  for (const file of files) {
    if (isSpecPath(file)) budget.specFiles += 1;
    const counts = countRegistrations(git('show', `${rev}:${file}`), file);
    budget.tests += counts.declared;
    budget.loopedTests += counts.looped;
  }
  return budget;
}

function main(): void {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error('Aufruf: bun scripts/ci/e2e-budget.ts <base> <head>');
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
      `::error::${result.messages[0]} Das Label „${E2E_OK_LABEL}“ setzt nur Hugo oder eine maintainende Person.`
    );
    process.exit(1);
  }
}

if (import.meta.main) main();
