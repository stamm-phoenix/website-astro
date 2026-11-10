/**
 * Starts one mock dev server per Playwright worker at the same time and reports when all
 * answer. Playwright starts the entries of `webServer` one after the other, which cost about
 * 3 s per server in CI.
 *
 * Run by playwright.config.ts: `bun scripts/e2e-servers.ts <first port> <count>`.
 *
 * With `E2E_SERVER=static` the servers are `e2e-static-server.ts` on the built site (run
 * `bun run build` first) instead of dev servers. They reset on request: a server that exits with
 * RESET_EXIT_CODE is started again on its port, so every test can begin on the demo data.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { RESET_EXIT_CODE } from './e2e-reset';

const [firstPort, count] = process.argv.slice(2).map(Number);
if (!Number.isInteger(firstPort) || !Number.isInteger(count) || count < 1) {
  console.error('Usage: bun scripts/e2e-servers.ts <first port> <count>');
  process.exit(1);
}

const TIMEOUT_MS = 60_000;
const ports = Array.from({ length: count }, (_, index) => firstPort + index);

// A server already running on a port would answer for the new one (and Astro would move the
// new one to another port), so the tests would share its demo state. Stop instead, as
// reuseExistingServer: false did when each port was its own webServer entry.
function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}
const busy = (
  await Promise.all(ports.map(async (port) => ((await isFree(port)) ? null : port)))
).filter((port) => port !== null);
if (busy.length > 0) {
  console.error(
    `Ports ${busy.join(', ')} are in use; stop the running dev servers or set E2E_PORT_BASE.`
  );
  process.exit(1);
}
const isStatic = process.env.E2E_SERVER === 'static';
const servers: ChildProcess[] = [];
let stopping = false;

function start(index: number): ChildProcess {
  const port = ports[index];
  const server = isStatic
    ? spawn('bun', ['scripts/e2e-static-server.ts', String(port)], {
        stdio: ['ignore', 'inherit', 'inherit'],
      })
    : spawn(
        'bun',
        ['run', 'dev:mock', '--host', '127.0.0.1', '--port', String(port), '--ignore-lock'],
        {
          // The Vite cache per port keeps the servers from overwriting each other's optimized deps
          env: { ...process.env, VITE_CACHE_SUFFIX: String(port) },
          stdio: ['ignore', 'inherit', 'inherit'],
        }
      );
  server.on('exit', (code) => {
    if (stopping) return;
    if (isStatic && code === RESET_EXIT_CODE) {
      servers[index] = start(index);
      return;
    }
    console.error(`Mock server on port ${port} exited with code ${code}`);
    stopAll(1);
  });
  return server;
}
for (let index = 0; index < ports.length; index++) servers[index] = start(index);

function stopAll(code: number): never {
  stopping = true;
  for (const server of servers) server.kill('SIGTERM');
  process.exit(code);
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

async function waitFor(port: number): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/gruppenstunden`);
      if (response.ok) return;
    } catch {
      // Not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Mock server on port ${port} did not answer within ${TIMEOUT_MS / 1000} s`);
}

try {
  await Promise.all(ports.map(waitFor));
  // playwright.config.ts waits for this line
  console.log(`E2E servers ready on ports ${ports.join(', ')}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stopAll(1);
}
