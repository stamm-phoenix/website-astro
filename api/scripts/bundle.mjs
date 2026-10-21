// Bundles the API for the Functions host (`main` in package.json): one file instead of the about
// 1100 files of node_modules and dist it would load on every cold start. Packages that read
// files next to themselves or load native code stay external. `--watch` rebuilds on changes.
import { spawn } from 'node:child_process';
import process from 'node:process';
import * as esbuild from 'esbuild';

const options = {
  entryPoints: ['main.ts', 'lib/protokoll-pdf-worker.ts'],
  bundle: true,
  platform: 'node',
  target: 'es2022',
  outdir: 'dist/bundle',
  entryNames: '[name]',
  external: ['@azure/functions', 'sharp', 'pdfmake', 'pdfjs-dist'],
  logLevel: 'warning',
};

if (process.argv.includes('--watch')) {
  // The tests and the package checks use the tsc output, so it is kept up to date as well
  spawn('tsc', ['-w', '--preserveWatchOutput'], { stdio: 'inherit', shell: true });
  await (await esbuild.context({ ...options, logLevel: 'info' })).watch();
} else {
  await esbuild.build(options);
}
