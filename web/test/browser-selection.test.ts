import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MOBILE_FILE_PATTERNS,
  MOBILE_ONLY_SPECS,
  DARK_TAG,
  MOBILE_TAG,
  matchesSpecPattern,
} from '../e2e-projects';

interface Spec {
  title: string;
  file: string;
  tags?: string[];
  tests: { projectName: string; expectedStatus: string }[];
}
interface Suite {
  title: string;
  specs: Spec[];
  suites?: Suite[];
}

// Discovery starts a separate Playwright process alongside lint and both type checkers in CI.
test(
  'mobile runs only phone specs, desktop runs every other test and none disappears',
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
    const tagged = new Set<string>();
    function visit(suite: Suite, parents: string[]): void {
      for (const spec of suite.specs) {
        const key = JSON.stringify([spec.file, ...parents, spec.title]);
        const projects = cases.get(key) ?? new Map<string, string>();
        for (const item of spec.tests) projects.set(item.projectName, item.expectedStatus);
        cases.set(key, projects);
        // The report lists the tag without its @
        if (spec.tags?.some((tag) => [MOBILE_TAG, DARK_TAG].includes(`@${tag}`))) tagged.add(key);
      }
      for (const child of suite.suites ?? []) visit(child, [...parents, child.title]);
    }
    for (const suite of report.suites) visit(suite, []);
    // Every browser test runs on desktop, except those of phone-only files, which run only on
    // mobile. A test runs on mobile when its file is listed or the test carries the tag.
    for (const [key, projects] of cases) {
      const [file] = JSON.parse(key) as string[];
      if (!projects.has('desktop') && !projects.has('mobile')) continue;
      assert.equal(
        projects.has('desktop'),
        !matchesSpecPattern(MOBILE_ONLY_SPECS, file),
        `${file}: desktop run`
      );
      assert.equal(
        projects.has('mobile'),
        matchesSpecPattern(MOBILE_FILE_PATTERNS, file) || tagged.has(key),
        `${file} ${key}: mobile run`
      );
    }
    // A listed pattern that matches no file would silently run nothing
    const allFiles = [...cases.keys()].map((key) => (JSON.parse(key) as string[])[0]);
    for (const pattern of MOBILE_FILE_PATTERNS) {
      assert.ok(
        allFiles.some((file) => matchesSpecPattern([pattern], file)),
        `${pattern} matches no spec`
      );
    }
    // A tag inside a file that runs on mobile as a whole says nothing
    for (const key of tagged) {
      const [file] = JSON.parse(key) as string[];
      assert.ok(!matchesSpecPattern(MOBILE_FILE_PATTERNS, file), `${file}: tag in a listed file`);
    }
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
