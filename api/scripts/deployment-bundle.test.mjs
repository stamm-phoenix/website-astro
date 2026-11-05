import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import { deploymentPlugin } from './deployment-bundle.mjs';
import { checkDeployment } from './check-deployment.mjs';

test('all relative spellings use runtime deployment values instead of inlined production defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deployment-bundle-'));
  try {
    await mkdir(join(root, 'lib/nested'), { recursive: true });
    const source = join(root, 'lib/deployment.ts');
    await writeFile(source, 'export const PREVIEW_DATABASE: string | null = null;');
    for (const [file, specifier] of [
      ['lib/sibling.ts', './deployment'],
      ['lib/nested/child.ts', '../deployment'],
      ['lib/nested/extension.ts', '../deployment.js'],
      ['lib/nested/absolute.ts', source],
    ]) {
      await writeFile(
        join(root, file),
        `export { PREVIEW_DATABASE } from ${JSON.stringify(specifier)};`
      );
      const result = await build({
        entryPoints: [join(root, file)],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        write: false,
        metafile: true,
        plugins: [deploymentPlugin(source)],
      });
      assert.ok(
        !Object.keys(result.metafile.inputs).some((path) => path.endsWith('/deployment.ts'))
      );
      for (const value of [null, 'website-pr-522']) {
        const module = { exports: {} };
        runInNewContext(result.outputFiles[0].text, {
          module,
          exports: module.exports,
          require: (path) => {
            assert.equal(path, './deployment.js');
            return { PREVIEW_DATABASE: value };
          },
        });
        assert.equal(module.exports.PREVIEW_DATABASE, value);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('upload checks reject production defaults, missing fields and wrong PR targets in a preview', () => {
  const production = {
    PREVIEW_DATABASE: null,
    PREVIEW_CONTAINER: null,
    PREVIEW_PLAYWRIGHT_API: null,
  };
  const preview = {
    ...production,
    PREVIEW_DATABASE: 'website-pr-522',
    PREVIEW_CONTAINER: 'pr-522',
  };
  checkDeployment(production);
  checkDeployment(preview, '522');
  assert.throws(() => checkDeployment(production, '522'));
  assert.throws(() => checkDeployment(preview));
  assert.throws(() => checkDeployment(preview, '523'));
  assert.throws(() => checkDeployment({ ...preview, PREVIEW_CONTAINER: null }, '522'));
  assert.throws(() => checkDeployment({ PREVIEW_DATABASE: 'website-pr-522' }, '522'));
});

test('Bun emits the checked CommonJS preview configuration consumed by the bundled API', async () => {
  const { readFile } = await import('node:fs/promises');
  const { spawnSync } = await import('node:child_process');
  const { createRequire } = await import('node:module');
  const root = await mkdtemp(join(tmpdir(), 'deployment-cjs-'));
  try {
    const source = (await readFile('lib/deployment.ts', 'utf8'))
      .replace(
        'PREVIEW_DATABASE: string | null = null;',
        "PREVIEW_DATABASE: string | null = 'website-pr-522';"
      )
      .replace(
        'PREVIEW_CONTAINER: string | null = null;',
        "PREVIEW_CONTAINER: string | null = 'pr-522';"
      );
    const input = join(root, 'deployment.ts');
    const output = join(root, 'deployment.cjs');
    await writeFile(input, source);
    const result = spawnSync(
      'bun',
      ['build', input, '--target=node', '--format=cjs', '--outfile', output],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    checkDeployment(createRequire(import.meta.url)(output), '522');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
