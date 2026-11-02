import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Spec {
  title: string;
  file: string;
  tests: { projectName: string; expectedStatus: string }[];
}
interface Suite {
  title: string;
  specs: Spec[];
  suites?: Suite[];
}

// Discovery starts a separate Playwright process alongside lint and both type checkers in CI.
test(
  'desktop exclusions have complete mobile counterparts and no other tests disappear',
  { timeout: 60_000 },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-selection-'));
    const output = join(dir, 'discovery.json');
    const result = spawnSync(
      'sh',
      [
        '-c',
        'node node_modules/@playwright/test/cli.js test --list --reporter=json > "$1"',
        'sh',
        output,
      ],
      {
        cwd: fileURLToPath(new URL('.', import.meta.url)) + '/..',
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
        timeout: 45_000,
      }
    );
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    const report = JSON.parse(readFileSync(output, 'utf8')) as { suites: Suite[] };
    rmSync(dir, { recursive: true, force: true });
    const cases = new Map<string, Map<string, string>>();
    function visit(suite: Suite, parents: string[]): void {
      for (const spec of suite.specs) {
        const key = JSON.stringify([spec.file, ...parents, spec.title]);
        const projects = cases.get(key) ?? new Map<string, string>();
        for (const item of spec.tests) projects.set(item.projectName, item.expectedStatus);
        cases.set(key, projects);
      }
      for (const child of suite.suites ?? []) visit(child, [...parents, child.title]);
    }
    for (const suite of report.suites) visit(suite, []);
    const mobileOnly = new Set([
      'essensplanung-ki-konflikte.spec.ts',
      'essensplanung-zeilen-konflikte.spec.ts',
      'essensplanung-einkaeufe-entwuerfe.spec.ts',
      'essensplanung-einkaeufe-konflikte.spec.ts',
      'protokoll-review.spec.ts',
    ]);
    const found = new Set<string>();
    for (const [key, projects] of cases) {
      const [file] = JSON.parse(key) as string[];
      if (mobileOnly.has(file)) found.add(file);
      if (projects.has('desktop') || projects.has('mobile')) {
        assert.equal(projects.get('mobile'), 'passed');
        assert.equal(projects.has('desktop'), !mobileOnly.has(file));
      }
    }
    assert.deepEqual(found, mobileOnly);
    const discoveredFiles = new Set(
      [...cases.keys()].map((key) => (JSON.parse(key) as string[])[0])
    );
    const files = readdirSync(join(fileURLToPath(new URL('.', import.meta.url)), '../tests'), {
      recursive: true,
      encoding: 'utf8',
    }).filter((file) => /\.spec\.ts$/.test(file));
    assert.deepEqual([...discoveredFiles].sort(), files.sort());
  }
);
