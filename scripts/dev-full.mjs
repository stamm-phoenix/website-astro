import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apiDirectory = fileURLToPath(new URL('../api/', import.meta.url));
if (!existsSync(new URL('../api/local.settings.json', import.meta.url))) {
  console.error(
    'Für dev:full zuerst api/local.settings.example.json nach api/local.settings.json kopieren und ausfüllen. Für simulierte Daten bun run dev:mock verwenden.'
  );
  process.exit(1);
}

const swa = fileURLToPath(new URL('../api/node_modules/.bin/swa', import.meta.url));
const args = [
  'start',
  'http://localhost:4321',
  '--api-location',
  '.',
  '--swa-config-location',
  '../web/public',
  '--run',
  'bun run --cwd ../web dev',
];
// The SWA CLI downloads Azure Functions binaries that need steam-run on NixOS.
const hasSteamRun = spawnSync('steam-run', ['true'], { stdio: 'ignore' }).status === 0;
const child = spawn(hasSteamRun ? 'steam-run' : swa, hasSteamRun ? [swa, ...args] : args, {
  cwd: apiDirectory,
  stdio: 'inherit',
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
