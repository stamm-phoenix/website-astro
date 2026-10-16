/**
 * Starts one mock dev server per Playwright worker at the same time and reports when all
 * answer. Playwright starts the entries of `webServer` one after the other, which cost about
 * 3 s per server in CI.
 *
 * Run by playwright.config.ts: `bun scripts/e2e-servers.ts <first port> <count>`.
 */
import { spawn, type ChildProcess } from 'node:child_process';

const [firstPort, count] = process.argv.slice(2).map(Number);
if (!Number.isInteger(firstPort) || !Number.isInteger(count) || count < 1) {
  console.error('Usage: bun scripts/e2e-servers.ts <first port> <count>');
  process.exit(1);
}

const TIMEOUT_MS = 60_000;
const ports = Array.from({ length: count }, (_, index) => firstPort + index);
const servers: ChildProcess[] = ports.map((port) =>
  spawn(
    'bun',
    ['run', 'dev:mock', '--host', '127.0.0.1', '--port', String(port), '--ignore-lock'],
    {
      // The Vite cache per port keeps the servers from overwriting each other's optimized deps
      env: { ...process.env, VITE_CACHE_SUFFIX: String(port) },
      stdio: ['ignore', 'inherit', 'inherit'],
    }
  )
);

function stopAll(code: number): never {
  for (const server of servers) server.kill('SIGTERM');
  process.exit(code);
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
for (const [index, server] of servers.entries()) {
  server.on('exit', (code) => {
    console.error(`Mock dev server on port ${ports[index]} exited with code ${code}`);
    stopAll(1);
  });
}

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
  throw new Error(`Mock dev server on port ${port} did not answer within ${TIMEOUT_MS / 1000} s`);
}

try {
  await Promise.all(ports.map(waitFor));
  // playwright.config.ts waits for this line
  console.log(`E2E servers ready on ports ${ports.join(', ')}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stopAll(1);
}
